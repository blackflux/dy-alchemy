/* eslint-disable max-classes-per-file */

class DefaultItemNotFoundError extends Error {
  constructor() {
    super('Item not found.');
  }
}
module.exports.DefaultItemNotFoundError = DefaultItemNotFoundError;

class DefaultItemExists extends Error {
  constructor() {
    super('Item exists.');
  }
}
module.exports.DefaultItemExistsError = DefaultItemExists;

class InvalidPageCursor extends Error {
  constructor() {
    super('Invalid Page Cursor.');
  }
}
module.exports.InvalidPageCursor = InvalidPageCursor;

class InvalidCondition extends Error {
  constructor(context) {
    super(`Invalid condition provided\n${context}`);
  }
}
module.exports.InvalidCondition = InvalidCondition;

class ConditionNotImplemented extends Error {
  constructor() {
    super('Condition not implemented');
  }
}
module.exports.ConditionNotImplemented = ConditionNotImplemented;

class CannotUpdatePrimaryKeys extends Error {
  constructor() {
    super('Cannot update "primaryKeys" attributes.');
  }
}
module.exports.CannotUpdatePrimaryKeys = CannotUpdatePrimaryKeys;

class GeneratedIdMismatch extends Error {
  constructor() {
    super('The generated id does not match the provided id for the DynamoDb entry.');
  }
}
module.exports.GeneratedIdMismatch = GeneratedIdMismatch;

class UnableToGenerateId extends Error {
  constructor() {
    super('Failed to generate id for DynamoDb entry.');
  }
}
module.exports.UnableToGenerateId = UnableToGenerateId;
