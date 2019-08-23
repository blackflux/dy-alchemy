const assert = require('assert');
const get = require('lodash.get');
const AWS = require('aws-sdk-wrap');
const { retain } = require('object-fields');
const objectHash = require('object-hash');
const { DataMapper, DynamoDbSchema, DynamoDbTable } = require('@aws/dynamodb-data-mapper');
const {
  DefaultItemNotFoundError, DefaultItemExistsError,
  CannotUpdatePrimaryKeys, UnableToGenerateId,
  GeneratedIdMismatch
} = require('./errors');
const { fromCursor, buildPageObject } = require('../util/paging');
const { validate, extract, evaluate } = require('../util/conditional');
const classGenerator = require('./class-generator');

const DefaultItemNotFound = ({ id }) => new DefaultItemNotFoundError(id);
const DefaultItemExists = ({ id }) => new DefaultItemExistsError(id);

class Model {
  constructor({
    modelName,
    tableName,
    schema,
    awsConfig,
    errorMap: {
      ItemNotFound = DefaultItemNotFound,
      ItemExists = DefaultItemExists
    } = {},
    callback = () => {},
    primaryKeys = null
  }) {
    assert(get(schema, 'id.keyType') === 'HASH', '"id" must have "Hash" keyType.');
    assert(Object.entries(schema)
      .filter(([k, _]) => k !== 'id')
      .every(([_, v]) => v.keyType === undefined), '"keyType" only allowed on "id".');
    assert(primaryKeys === null || Array.isArray(primaryKeys));

    const MapperClass = classGenerator();
    Object.defineProperties(MapperClass.prototype, {
      [DynamoDbTable]: { value: tableName },
      [DynamoDbSchema]: { value: schema }
    });
    const aws = AWS({ config: awsConfig });
    this.mapper = new DataMapper({ client: aws.get('dynamodb') });
    this.modelName = modelName;
    this.tableName = tableName;
    this.MapperClass = MapperClass;
    this.ItemNotFound = ItemNotFound;
    this.ItemExists = ItemExists;
    this.callback = callback;
    this.primaryKeys = primaryKeys;
    this.defaultValues = Object.entries(schema)
      .filter(([key, value]) => value.defaultValue !== undefined)
      .reduce((prev, [key, value]) => Object.assign(prev, { [key]: value.defaultValue }), {});
  }

  // eslint-disable-next-line no-underscore-dangle
  _before() {
    Object.entries({
      modelName: this.modelName,
      tableName: this.tableName
    })
      .forEach(([key, value]) => {
        if (typeof value !== 'string' || value === '') {
          throw new Error(`Missing required value: ${key}`);
        }
      });
  }

  // eslint-disable-next-line no-underscore-dangle
  _callback(actionType, id) {
    return this.callback({
      id,
      actionType,
      modelName: this.modelName,
      tableName: this.tableName
    });
  }

  // eslint-disable-next-line no-underscore-dangle
  _generateId(id, modelData = null) {
    assert(typeof id === 'string' || id === null || (id instanceof Object && !Array.isArray(id)), id);
    assert(modelData === null || (modelData instanceof Object && !Array.isArray(modelData)), modelData);
    let result = null;
    if (typeof id === 'string') {
      result = id;
    }
    const toCheck = [id, modelData];
    for (let idx = 0; idx < toCheck.length; idx += 1) {
      const data = toCheck[idx];
      if (
        data instanceof Object
        && !Array.isArray(data)
        && this.primaryKeys !== null
        && this.primaryKeys.every((k) => data[k] !== undefined)
      ) {
        const generatedId = objectHash(this.primaryKeys
          .reduce((prev, cur) => Object.assign(prev, { [cur]: data[cur] }), {}));
        if (![null, generatedId].includes(result)) {
          throw new GeneratedIdMismatch();
        }
        result = generatedId;
      }
    }
    if (typeof result !== 'string') {
      throw new UnableToGenerateId();
    }
    return result;
  }

  async get({
    id: providedId,
    fields,
    conditions = []
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    // eslint-disable-next-line no-underscore-dangle
    const id = this._generateId(providedId);
    const condition = {
      type: 'And',
      conditions: [
        { subject: 'id', type: 'Equals', object: id },
        ...conditions
      ]
    };
    validate(condition);
    let resp;
    const projection = Array.from(new Set(fields.concat(extract(condition))));
    try {
      resp = await this.mapper.get(new this.MapperClass({ id }), {
        projection,
        readConsistency: 'strong'
      });
    } catch (err) {
      if (err.name === 'ItemNotFoundException') {
        throw this.ItemNotFound({ id, reason: 'item_not_found' });
      }
      throw err;
    }
    projection.forEach((field) => {
      if (resp[field] === undefined && this.defaultValues[field] !== undefined) {
        resp[field] = this.defaultValues[field];
      }
    });
    if (evaluate(condition, resp) !== true) {
      throw this.ItemNotFound({ id, reason: 'conditional_check_failed' });
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('get', id);
    retain(resp, fields);
    return resp;
  }

  async create({
    id: providedId = null,
    data,
    fields,
    conditions = []
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    // eslint-disable-next-line no-underscore-dangle
    const id = this._generateId(providedId, data);
    const condition = {
      type: 'And',
      conditions: [
        { subject: 'id', type: 'NotEquals', object: id },
        ...conditions
      ]
    };
    validate(condition);
    try {
      await this.mapper.put(new this.MapperClass({ ...data, id }), { condition });
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        throw this.ItemExists({ id });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('create', id);
    return this.get({ id, fields });
  }

  async update({
    id: providedId,
    data,
    fields,
    conditions = []
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    // eslint-disable-next-line no-underscore-dangle
    const id = this._generateId(providedId, data);
    const condition = {
      type: 'And',
      conditions: [
        { subject: 'id', type: 'Equals', object: id },
        ...conditions
      ]
    };
    validate(condition);
    if (Array.isArray(this.primaryKeys) && this.primaryKeys.some((k) => data[k] !== undefined)) {
      throw new CannotUpdatePrimaryKeys();
    }
    try {
      await this.mapper.update(new this.MapperClass({ ...data, id }), {
        condition,
        onMissing: 'skip'
      });
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        throw this.ItemNotFound({ id, reason: 'conditional_check_failed' });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('update', id);
    return this.get({ id, fields });
  }

  async upsert({
    id: providedId = null,
    data,
    fields,
    conditions = []
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    // eslint-disable-next-line no-underscore-dangle
    const id = this._generateId(providedId, data);
    const condition = { type: 'And', conditions };
    validate(condition);
    await this.mapper.put(
      new this.MapperClass({ ...data, id }),
      conditions.length === 0 ? {} : { condition }
    );
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('upsert', id);
    return this.get({ id, fields });
  }

  async delete({
    id: providedId,
    conditions = []
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    // eslint-disable-next-line no-underscore-dangle
    const id = this._generateId(providedId);
    const condition = {
      type: 'And',
      conditions: [
        { subject: 'id', type: 'Equals', object: id },
        ...conditions
      ]
    };
    validate(condition);
    try {
      await this.mapper.delete(new this.MapperClass({ id }), {
        condition,
        returnValues: 'NONE'
      });
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        throw this.ItemNotFound({ id, reason: 'conditional_check_failed' });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('delete', id);
  }

  async list({
    indexName,
    indexMap,
    fields,
    ascending = true,
    limit = 20,
    cursor = null
  }) {
    // eslint-disable-next-line no-underscore-dangle
    this._before();
    const fieldsContainsId = fields.includes('id');
    const toQuery = fieldsContainsId ? fields : [...fields, 'id'];

    const {
      lastEvaluatedKey = null,
      scanIndexForward = ascending,
      limit: queryLimit = limit,
      currentPage = null
    } = fromCursor(cursor);
    const iterator = this.mapper.query(this.MapperClass, indexMap, {
      indexName,
      projection: toQuery,
      scanIndexForward,
      limit: queryLimit,
      ...(lastEvaluatedKey === null ? {} : { startKey: lastEvaluatedKey })
    });
    const payload = [];
    // eslint-disable-next-line no-restricted-syntax,no-unused-vars
    for await (const r of iterator) {
      payload.push(r);
      // eslint-disable-next-line no-underscore-dangle
      await this._callback('list', r.id);
    }

    const page = buildPageObject(
      currentPage === null ? 1 : currentPage,
      queryLimit,
      get(iterator, 'paginator.lastKey', null)
    );

    if (!fieldsContainsId) {
      payload.forEach((p) => {
        // eslint-disable-next-line no-param-reassign
        delete p.id;
      });
    }
    return { payload, page };
  }
}

module.exports = Model;
