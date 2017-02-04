// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var Constants = require('./util/constants'),
  ErrorCodes = Constants.ErrorCodes,
  log = require('./util/logging');
class SpecValidationResult {

  constructor() {
    this.validityStatus = true;
    this.operations = {};
  }

  setResolveSpecError(e) {
    this.resolveSpec = e;
    return;
  }

  /*
   * Updates the validityStatus of the internal specValidationResult based on the provided value.
   * 
   * @param {boolean} value A truthy or a falsy value.
   */
  updateValidityStatus(value) {
    if (!Boolean(value)) {
      this.validityStatus = false;
    } else {
      this.validityStatus = true;
    }
    return;
  }

  /*
   * Constructs the Error object and updates the validityStatus unless indicated to not update the status.
   * 
   * @param {string} code The Error code that uniquely idenitifies the error.
   * 
   * @param {string} message The message that provides more information about the error.
   * 
   * @param {array} [innerErrors] An array of Error objects that specify inner details.
   * 
   * @param {boolean} [skipValidityStatusUpdate] When specified a truthy value it will skip updating the validity status.
   * 
   * @return {object} err Return the constructed Error object.
   */
  constructErrorObject(code, message, innerErrors, skipValidityStatusUpdate) {
    let err = {
      code: code,
      message: message,
    }
    if (innerErrors) {
      err.innerErrors = innerErrors;
    }
    if (!skipValidityStatusUpdate) {
      this.validationResult.updateValidityStatus();
    }
    return err;
  }

  initializeExampleResult(operationId, exampleType, scenarioName) {
    let initialResult = {
      isValid: true,
      request: {
        isValid: true
      },
      responses: {}
    };
    let operationResult = this.specValidationResult.operations[operationId];
    if (!operationResult) {
      operationResult = {};
    }
    if (!operationResult[exampleType]) {
      operationResult[exampleType] = initialResult;
    }

    if (exampleType === Constants.xmsExamples) {
      if (!operationResult[exampleType].scenarios) {
        operationResult[exampleType].scenarios = {};
      }
      if (!operationResult[exampleType].scenarios[scenarioName]) {
        operationResult[exampleType].scenarios[scenarioName] = initialResult;
      }
    }
    this.specValidationResult.operations[operationId] = operationResult;
    return;
  }

  constructRequestResult(operationResult, isValid, msg, requestValidationErrors, requestValidationWarnings) {
    if (!isValid) {
      operationResult.isValid = false;
      operationResult.request.isValid = false;
      let e = this.constructErrorObject(ErrorCodes.RequestValidationError, msg, requestValidationErrors);
      operationResult.request.error = e;
      log.error(`${msg}:\n`, e);
    } else if (requestValidationWarnings) {
      operationResult.request.warning = requestValidationWarnings;
      log.warn(`${msg}:\n`, requestValidationWarnings);
    } else {
      operationResult.request.isValid = true;
      operationResult.request.result = msg;
      log.info(`${msg}`);
    }
    return;
  }

  constructResponseResult(operationResult, responseStatusCode, isValid, msg, responseValidationErrors, responseValidationWarnings) {
    if (!operationResult.responses[responseStatusCode]) {
      operationResult.responses[responseStatusCode] = {};
    }
    if (!isValid) {
      operationResult.isValid = false;
      operationResult.responses[responseStatusCode].isValid = false;
      let e = this.constructErrorObject(ErrorCodes.ResponseValidationError, msg, responseValidationErrors);
      operationResult.responses[responseStatusCode].error = e;
      log.error(`${msg}:\n`, e);
    } else if (responseValidationWarnings) {
      operationResult.responses[responseStatusCode].warning = responseValidationWarnings;
      log.warn(`${msg}:\n`, responseValidationWarnings);
    } else {
      operationResult.responses[responseStatusCode].isValid = true;
      operationResult.responses[responseStatusCode].result = msg;
      log.info(`${msg}`);
    }
    return;
  }

  constructRequestResultWrapper(operationId, requestValidationErrors, requestValidationWarnings, exampleType, scenarioName) {
    this.initializeExampleResult(operationId, exampleType, scenarioName);
    let operationResult, part, subMsg, infoMsg, errorMsg, warnMsg;
    if (exampleType === Constants.xmsExamples) {
      operationResult = this.specValidationResult.operations[operationId][exampleType].scenarios[scenarioName];
      part = `for x-ms-example "${scenarioName}" in operation "${operationId}"`;
    } else {
      operationResult = this.specValidationResult.operations[operationId][exampleType];
      part = `for example in spec for operation "${operationId}"`;
    }
    subMsg = `validating the request ${part}`;
    infoMsg = `Request parameters ${part} is valid.`;
    if (requestValidationErrors && requestValidationErrors.length) {
      errorMsg = `Found errors in ${subMsg}.`;
      this.constructRequestResult(operationResult, false, errorMsg, requestValidationErrors);
    } else {
      this.constructRequestResult(operationResult, true, infoMsg);
    }
    if (requestValidationWarnings && requestValidationWarnings.length) {
      warnMsg = `Found warnings in ${subMsg}.`;
      this.constructRequestResult(operationResult, true, warnMsg, null, requestValidationWarnings);
    }
    return;
  }

  constructResponseResultWrapper(operationId, responseStatusCode, responseValidationErrors, responseValidationWarnings, exampleType, scenarioName) {
    this.initializeExampleResult(operationId, exampleType, scenarioName);
    let operationResult, part, subMsg, infoMsg, errorMsg, warnMsg;
    if (exampleType === Constants.xmsExamples) {
      operationResult = this.specValidationResult.operations[operationId][exampleType].scenarios[scenarioName];
      part = `for x-ms-example "${scenarioName}" in operation "${operationId}"`;
    } else {
      operationResult = this.specValidationResult.operations[operationId][exampleType];
      part = `for example in spec for operation "${operationId}"`;
    }
    subMsg = `validating the response with statusCode "${responseStatusCode}" ${part}`;
    infoMsg = `Response with statusCode "${responseStatusCode}" ${part} is valid.`;
    if (responseValidationErrors && responseValidationErrors.length) {
      errorMsg = `Found errors in ${subMsg}.`;
      this.constructResponseResult(operationResult, responseStatusCode, false, errorMsg, responseValidationErrors);
    } else {
      this.constructResponseResult(operationResult, responseStatusCode, true, infoMsg);
    }
    if (responseValidationWarnings && responseValidationWarnings.length) {
      warnMsg = `Found warnings in ${subMsg}.`;
      this.constructResponseResult(operationResult, responseStatusCode, true, warnMsg, null, responseValidationWarnings);
    }
    return;
  }

  /*
   * Cosntructs the validation result for an operation.
   * 
   * @param {object} operation - The operation object.
   * 
   * @param {object} result - The validation result that needs to be added to the uber 
   * validationResult object for the entire spec.
   * 
   * @param {string} exampleType A string specifying the type of example. "x-ms-example", "example-in-spec".
   * 
   * @return {object} xmsExample - The xmsExample object.
   */
  constructOperationResult(operation, result, exampleType) {
    let operationId = operation.operationId;
    if (result.exampleNotFound) {
      this.specValidationResult.operations[operationId][exampleType].error = result.exampleNotFound;
      log.error(result.exampleNotFound);
    }
    if (exampleType === Constants.xmsExamples) {
      if (result.scenarios) {
        for (let scenario in result.scenarios) {
          //requestValidation
          let requestValidationErrors = result.scenarios[scenario].requestValidation.validationResult.errors;
          let requestValidationWarnings = result.scenarios[scenario].requestValidation.validationResult.warnings;
          this.constructRequestResultWrapper(operationId, requestValidationErrors, requestValidationWarnings, exampleType, scenario);
          //responseValidation
          for (let responseStatusCode in result.scenarios[scenario].responseValidation) {
            let responseValidationErrors = result.scenarios[scenario].responseValidation[responseStatusCode].errors;
            let responseValidationWarnings = result.scenarios[scenario].responseValidation[responseStatusCode].warnings;
            this.constructResponseResultWrapper(operationId, responseStatusCode, responseValidationErrors, responseValidationWarnings, exampleType, scenario);
          }
        }
      }
    } else if (exampleType === Constants.exampleInSpec) {
      if (result.requestValidation && Object.keys(result.requestValidation).length) {
        //requestValidation
        let requestValidationErrors = result.requestValidation.validationResult.errors;
        let requestValidationWarnings = result.requestValidation.validationResult.warnings;
        this.constructRequestResultWrapper(operationId, requestValidationErrors, requestValidationWarnings, exampleType);
      }
      if (result.responseValidation && Object.keys(result.responseValidation).length) {
        //responseValidation
        for (let responseStatusCode in result.responseValidation) {
          let responseValidationErrors = result.responseValidation[responseStatusCode].errors;
          let responseValidationWarnings = result.responseValidation[responseStatusCode].warnings;
          this.constructResponseResultWrapper(operationId, responseStatusCode, responseValidationErrors, responseValidationWarnings, exampleType);
        }
      }
    }
    return;
  }

  initializeValidateSpec() {
    this.validateSpec = {
      isValid: true
    }
  }

  constructInitializationError(methodName) {
    let msg = `Please call "specValidator.initialize()" before calling the "${methodName}" method, so that swaggerApi is populated.`;
    let e = this.constructErrorObject(ErrorCodes.InitializationError, msg)
    this.initialize = e;
    log.error(`${ErrorCodes.InitializationError}: ${msg}`);
    return e;
  }

}

module.exports = SpecValidationResult;