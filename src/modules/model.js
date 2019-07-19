const AWS = require('aws-sdk-wrap');
const objectFields = require('object-fields');
const { DataMapper, DynamoDbSchema, DynamoDbTable } = require('@aws/dynamodb-data-mapper');
const { DefaultItemNotFoundError, DefaultItemExistsError } = require('./errors');

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
    callback = () => {}
  }) {
    class InternalDataMapperClass {}
    Object.defineProperties(InternalDataMapperClass.prototype, {
      [DynamoDbTable]: { value: tableName },
      [DynamoDbSchema]: { value: schema }
    });
    const aws = AWS({ config: awsConfig });
    const mapper = new DataMapper({ client: aws.get('dynamodb') });
    this.mapper = mapper;
    this.modelName = modelName;
    this.tableName = tableName;
    this.InternalDataMapperClass = InternalDataMapperClass;
    this.ItemNotFound = ItemNotFound;
    this.ItemExists = ItemExists;
    this.callback = callback;
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

  precheck() {
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

  async get({ id, fields }) {
    this.precheck();
    let resp;
    try {
      resp = await this.mapper.get(Object.assign(new this.InternalDataMapperClass(), { id }), {
        projection: objectFields.split(fields),
        readConsistency: 'strong'
      });
    } catch (err) {
      if (err.name === 'ItemNotFoundException') {
        throw this.ItemNotFound({ id });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('get', id);
    return resp;
  }

  async create({ id, data, fields }) {
    this.precheck();
    try {
      await this.mapper.put(Object.assign(new this.InternalDataMapperClass(), data, { id }), {
        condition: {
          subject: 'id',
          type: 'NotEquals',
          object: id
        }
      });
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

  async update({ id, data, fields }) {
    this.precheck();
    try {
      await this.mapper.update(Object.assign(new this.InternalDataMapperClass(), data, { id }), {
        condition: {
          subject: 'id',
          type: 'Equals',
          object: id
        },
        onMissing: 'skip'
      });
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        throw this.ItemNotFound({ id });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('update', id);
    return this.get({ id, fields });
  }

  async delete({ id }) {
    this.precheck();
    try {
      await this.mapper.delete(Object.assign(new this.InternalDataMapperClass(), { id }), {
        condition: {
          subject: 'id',
          type: 'Equals',
          object: id
        },
        returnValues: 'NONE'
      });
    } catch (err) {
      if (err.code === 'ConditionalCheckFailedException') {
        throw this.ItemNotFound({ id });
      }
      throw err;
    }
    // eslint-disable-next-line no-underscore-dangle
    await this._callback('delete', id);
  }

  async list({ indexName, indexMap, fields }) {
    this.precheck();
    const iterator = this.mapper.query(this.InternalDataMapperClass, indexMap, {
      indexName,
      projection: objectFields.split(fields)
    });
    const resp = [];
    // eslint-disable-next-line no-restricted-syntax
    for await (const r of iterator) {
      resp.push(r);
    }
    return resp;
  }
}

module.exports = Model;
