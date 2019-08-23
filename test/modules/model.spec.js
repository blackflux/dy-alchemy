const expect = require('chai').expect;
const { describe } = require('node-tdd');
const DynamoModel = require('../../src/modules/model');
const {
  DefaultItemExistsError, DefaultItemNotFoundError,
  InvalidPageCursor,
  CannotUpdatePrimaryKeys, GeneratedIdMismatch, UnableToGenerateId
} = require('../../src/modules/errors');


class CustomError extends Error {
  constructor(prefix, id) {
    super(`${prefix}: ${id}`);
  }
}

const CustomItemExists = ({ id }) => new CustomError('Item exists', id);
const CustomItemNotFound = ({ id }) => new CustomError('Item not found', id);

const schema = {
  id: {
    type: 'String',
    keyType: 'HASH'
  },
  title: {
    type: 'String'
  },
  year: {
    type: 'Number'
  },
  keywords: {
    type: 'List',
    memberType: { type: 'String' }
  },
  isWatched: {
    type: 'Boolean',
    defaultValue: false
  }
};

describe('Dynamo Sdk Tests', { useNock: true }, () => {
  let callbackLog = [];
  let defaultModel;
  let customErrorModel;
  let autoIdModel;
  let awsConfig;

  before(() => {
    awsConfig = {
      region: process.env.AWS_REGION,
      accessKeyId: process.env.INTER_SERVICE_ACCESS_KEY_ID,
      secretAccessKey: process.env.INTER_SERVICE_SECRET_ACCESS_KEY
    };
    defaultModel = new DynamoModel({
      modelName: 'default',
      tableName: 'dy-alchemy-table',
      schema,
      awsConfig,
      callback: (args) => {
        callbackLog.push(args);
      }
    });
    customErrorModel = new DynamoModel({
      modelName: 'customErrorMap',
      tableName: 'dy-alchemy-table',
      schema,
      awsConfig,
      errorMap: {
        ItemExists: CustomItemExists,
        ItemNotFound: CustomItemNotFound
      }
    });
    autoIdModel = new DynamoModel({
      modelName: 'default',
      tableName: 'dy-alchemy-table',
      schema,
      awsConfig,
      callback: (args) => {
        callbackLog.push(args);
      },
      primaryKeys: ['keywords', 'title']
    });
  });

  afterEach(() => {
    callbackLog = [];
  });

  it('Init With Defaults', () => {
    // eslint-disable-next-line no-new
    new DynamoModel({ modelName: '', tableName: '', schema });
  });

  it('Testing precheck', async () => {
    const model = new DynamoModel({ modelName: 'model', awsConfig, schema });
    try {
      await model.get({ id: 'uuid', fields: ['keywords'] });
    } catch (err) {
      expect(err.message).to.equal('Missing required value: tableName');
    }
  });

  const checkCallbackLog = (actionTypes, id = 'uuid') => {
    expect(callbackLog).to.deep.equal(actionTypes.map((actionType) => ({
      id,
      modelName: 'default',
      tableName: 'dy-alchemy-table',
      actionType
    })));
  };

  describe('Testing Get', () => {
    it('Testing Get Base Case', async () => {
      expect(await defaultModel.get({ id: 'uuid', fields: ['keywords'] }))
        .to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['get']);
    });

    it('Testing Get With Default Value', async () => {
      expect(await defaultModel.get({ id: 'uuid', fields: ['isWatched'] }))
        .to.deep.equal({ isWatched: false });
      checkCallbackLog(['get']);
    });

    it('Testing Get with Primary Key', async () => {
      expect(await autoIdModel.get({
        id: {
          keywords: ['keyword1', 'keyword2'],
          title: 'title'
        },
        fields: ['title']
      })).to.deep.equal({ title: 'title' });
      checkCallbackLog(['get'], 'aca3ddb278ff58d7ac44cebd96802b3e66528910');
    });

    it('Testing Get Condition Not Matched', async () => {
      try {
        await defaultModel.get({
          id: 'uuid',
          fields: ['keywords'],
          conditions: [{
            subject: 'id', type: 'Equals', object: '1234'
          }]
        });
      } catch (err) {
        expect(err).instanceof(DefaultItemNotFoundError);
        expect(err.message).to.equal('Item not found.');
        checkCallbackLog([]);
      }
    });

    it('Testing Get Custom Error Sdk (default callback coverage)', async () => {
      const result = await customErrorModel.get({ id: 'uuid', fields: ['keywords'] });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
    });

    it('Testing Get ItemNotFound Custom', async () => {
      try {
        await customErrorModel.get({ id: 'uuid', fields: ['keywords'] });
      } catch (err) {
        expect(err).instanceof(CustomError);
        expect(err.message).to.equal('Item not found: uuid');
      }
    });

    it('Testing Get ItemNotFound Default', async () => {
      try {
        await defaultModel.get({ id: 'uuid', fields: ['keywords'] });
      } catch (err) {
        expect(err).instanceof(DefaultItemNotFoundError);
        expect(err.message).to.equal('Item not found.');
        checkCallbackLog([]);
      }
    });

    it('Testing Get Error', async () => {
      try {
        await defaultModel.get({ id: 'uuid', fields: ['keywords'] });
      } catch (err) {
        expect(err.code).to.equal('UnknownError');
        checkCallbackLog([]);
      }
    });
  });

  describe('Testing Create', () => {
    it('Testing Create Base Case', async () => {
      const result = await defaultModel.create({
        id: 'uuid',
        data: { keywords: ['keyword1', 'keyword2'] },
        fields: ['keywords']
      });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['create', 'get']);
    });

    it('Testing Create with Automatic Id', async () => {
      const result = await autoIdModel.create({
        data: {
          keywords: ['keyword1', 'keyword2'],
          title: 'title'
        },
        fields: ['keywords']
      });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['create', 'get'], 'aca3ddb278ff58d7ac44cebd96802b3e66528910');
    });

    it('Testing Create IncompletePrimaryKey', async () => {
      try {
        await autoIdModel.create({
          data: {
            keywords: ['keyword1', 'keyword2']
          },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(UnableToGenerateId);
      }
    });

    it('Testing Provided Id and Generated Mismatch', async () => {
      try {
        await autoIdModel.create({
          id: 'uuid',
          data: {
            keywords: ['keyword1', 'keyword2'],
            title: 'title'
          },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(GeneratedIdMismatch);
      }
    });

    it('Testing Create Item Exists Custom', async () => {
      try {
        await customErrorModel.create({
          id: 'uuid',
          data: { keywords: ['keyword1', 'keyword2'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(CustomError);
        expect(err.message).to.equal('Item exists: uuid');
      }
    });

    it('Testing Create Item Exists Default', async () => {
      try {
        await defaultModel.create({
          id: 'uuid',
          data: { keywords: ['keyword1', 'keyword2'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(DefaultItemExistsError);
        expect(err.message).to.equal('Item exists.');
        checkCallbackLog([]);
      }
    });

    it('Testing Create Error', async () => {
      try {
        await defaultModel.create({
          id: 'uuid',
          data: { keywords: ['keyword1', 'keyword2'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err.code).to.equal('UnknownError');
        checkCallbackLog([]);
      }
    });
  });

  describe('Testing Update', () => {
    it('Testing Update Base Case', async () => {
      const result = await defaultModel.update({
        id: 'uuid',
        data: { keywords: ['keyword1'] },
        fields: ['keywords']
      });
      expect(result).to.deep.equal({ keywords: ['keyword1'] });
      checkCallbackLog(['update', 'get']);
    });

    it('Testing Update with Primary Key', async () => {
      expect(await autoIdModel.update({
        id: {
          keywords: ['keyword1', 'keyword2'],
          title: 'title'
        },
        data: { year: 1980 },
        fields: ['title']
      })).to.deep.equal({ title: 'title' });
      checkCallbackLog(['update', 'get'], 'aca3ddb278ff58d7ac44cebd96802b3e66528910');
    });

    it('Testing Update with Condition', async () => {
      const result = await defaultModel.update({
        id: 'uuid',
        data: { keywords: ['keyword1'] },
        fields: ['keywords'],
        conditions: [{ subject: 'title', type: 'Equals', object: 'title-name' }]
      });
      expect(result).to.deep.equal({ keywords: ['keyword1'] });
      checkCallbackLog(['update', 'get']);
    });

    it('Testing Update Primary Key', async () => {
      try {
        await autoIdModel.update({
          id: 'uuid',
          data: { keywords: ['keyword1'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(CannotUpdatePrimaryKeys);
      }
    });

    it('Testing Update Not Found', async () => {
      try {
        await defaultModel.update({
          id: 'uuid',
          data: { keywords: ['keyword1'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err).instanceof(DefaultItemNotFoundError);
        checkCallbackLog([]);
      }
    });

    it('Testing Update Error', async () => {
      try {
        await defaultModel.update({
          id: 'uuid',
          data: { keywords: ['keyword1'] },
          fields: ['keywords']
        });
      } catch (err) {
        expect(err.code).to.equal('UnknownError');
        checkCallbackLog([]);
      }
    });
  });

  describe('Testing Upsert', () => {
    it('Testing Upsert Base Case', async () => {
      const result = await defaultModel.upsert({
        id: 'uuid',
        data: { keywords: ['keyword1', 'keyword2'] },
        fields: ['keywords']
      });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['upsert', 'get']);
    });

    it('Testing Upsert with Automatic Id', async () => {
      const result = await autoIdModel.upsert({
        data: {
          keywords: ['keyword1', 'keyword2'],
          title: 'title'
        },
        fields: ['keywords']
      });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['upsert', 'get'], 'aca3ddb278ff58d7ac44cebd96802b3e66528910');
    });

    it('Testing Upsert With Conditions', async () => {
      const result = await defaultModel.upsert({
        id: 'uuid',
        data: { title: 'new-title' },
        fields: ['keywords'],
        conditions: [{ subject: 'title', type: 'NotEquals', object: 'title' }]
      });
      expect(result).to.deep.equal({ keywords: ['keyword1', 'keyword2'] });
      checkCallbackLog(['upsert', 'get']);
    });
  });

  describe('Testing Delete', () => {
    it('Testing Delete Base Case', async () => {
      await defaultModel.delete({ id: 'uuid' });
      checkCallbackLog(['delete']);
    });

    it('Testing Delete with Primary Key', async () => {
      await autoIdModel.delete({
        id: {
          keywords: ['keyword1', 'keyword2'],
          title: 'title'
        }
      });
      checkCallbackLog(['delete'], 'aca3ddb278ff58d7ac44cebd96802b3e66528910');
    });

    it('Testing Delete with Condition', async () => {
      await defaultModel.delete({
        id: 'uuid',
        conditions: [{ subject: 'title', type: 'Equals', object: 'title-name' }]
      });
      checkCallbackLog(['delete']);
    });

    it('Testing Delete Not Found', async () => {
      try {
        await defaultModel.delete({ id: 'uuid' });
      } catch (err) {
        expect(err).instanceof(DefaultItemNotFoundError);
        checkCallbackLog([]);
      }
    });

    it('Testing Delete Error', async () => {
      try {
        await defaultModel.delete({ id: 'uuid' });
      } catch (err) {
        expect(err.code).to.equal('UnknownError');
        checkCallbackLog([]);
      }
    });
  });

  describe('Testing List', () => {
    it('Testing List Base Case', async () => {
      const result = await defaultModel.list({
        indexName: 'index-name',
        indexMap: { title: 'title', year: 1980 },
        fields: ['id', 'title']
      });
      expect(result).to.deep.equal({
        payload: [{ id: 'uuid', title: 'title' }],
        page: {
          next: null,
          index: { current: 1 },
          size: 20
        }
      });
      checkCallbackLog(['list']);
    });

    it('Testing List without Id', async () => {
      const result = await defaultModel.list({
        indexName: 'index-name',
        indexMap: { title: 'title', year: 1980 },
        fields: ['title']
      });
      expect(result).to.deep.equal({
        payload: [{ title: 'title' }],
        page: {
          next: null,
          index: { current: 1 },
          size: 20
        }
      });
      checkCallbackLog(['list']);
    });

    it('Testing List with Paging', async () => {
      const result = await defaultModel.list({
        indexName: 'index-name',
        indexMap: { title: 'title', year: 1980 },
        fields: ['id', 'title'],
        limit: 1,
        cursor: 'eyJsYXN0RXZhbHVhdGVkS2V5Ijp7ImlkIjoidXVpZCIsInRpdGxlIjoidGl0bGUiLCJ5ZWFyIjoxOTgwfSwic2'
          + 'NhbkluZGV4Rm9yd2FyZCI6dHJ1ZSwibGltaXQiOjEsImN1cnJlbnRQYWdlIjoyfQ=='
      });
      expect(result).to.deep.equal({
        payload: [{ id: 'uuid', title: 'title' }],
        page: {
          next: {
            limit: 1,
            cursor: 'eyJsYXN0RXZhbHVhdGVkS2V5Ijp7ImlkIjoidXVpZCIsInRpdGxlIjoidGl0bGUiLCJ5ZWFyIjoxOTgwfSwi'
              + 'c2NhbkluZGV4Rm9yd2FyZCI6dHJ1ZSwiY3VycmVudFBhZ2UiOjMsImxpbWl0IjoxfQ=='
          },
          index: { current: 2 },
          size: 1
        }
      });
      checkCallbackLog(['list']);
    });

    it('Testing List with Invalid Cursor', async () => {
      try {
        await defaultModel.list({
          indexName: 'index-name',
          indexMap: { title: 'title', year: 1980 },
          fields: ['id', 'title'],
          cursor: '--invalid--'
        });
      } catch (err) {
        expect(err).to.be.instanceOf(InvalidPageCursor);
        checkCallbackLog([]);
      }
    });
  });
});
