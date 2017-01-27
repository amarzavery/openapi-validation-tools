// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var fs = require('fs'),
    path = require('path'),
    util = require('util'),
    deasync = require('deasync'),
    swt = require('swagger-tools').specs.v2,
    RefParser = require('json-schema-ref-parser'),
    utils = require('./util/utils'),
    constants = require('./util/constants'),
    cwd = process.cwd();

var validateModel = deasync(swt.validateModel);

class SpecValidator {

  constructor(specPath) {
    if (!specPath && typeof specPath.valueOf() !== 'string') {
      throw new Error('specPath (A file or a rawgithub url) cannot be null or undefined and must of type string');
    }
    this.specPath = specPath;
    this.specInJson = null;
    this.refSpecInJson = null;
    this.specValidationResult = {};
    this.initialize();
  }

  //wrapper to validateModel of swagger-tools
  bundleSpec() {
    let self = this;
    return function (callback) {
      RefParser.bundle(self.specPath, callback);
    }
  }

  //wrapper to validateModel of swagger-tools
  resolveSpec(specPath, data) {
    let self = this;
    return function (callback) {
      RefParser.validateModel(self.specPath, callback);
    }
  }

  initialize() {
    let self = this;
    utils.run(function* () {
      try {
        self.specInJson = yield self.bundleSpec();
        self.refSpecInJson = yield self.resolveSpec();
      } catch (err) {
        throw err;
      }
    });
  }

  initialize1() {
    let self = this;
    try {
      let resolveDone = false;
      let bundleDone = false;
      RefParser.bundle(self.specPath, function (err, result) {
        if (err) throw err;
        self.specInJson = result;
        bundleDone = true;
      });
      deasync.loopWhile(function () { return !bundleDone; });
      RefParser.resolve(self.specPath, function (err, result) {
        if (err) throw err;
        self.refSpecInJson = result;
        resolveDone = true;
      });
      deasync.loopWhile(function () { return !resolveDone; });
    } catch (err) {
      throw err;
    }
  }

  unifyXmsPaths() {
    //unify x-ms-paths into paths
    if (this.specInJson['x-ms-paths'] && this.specInJson['x-ms-paths'] instanceof Object &&
      Object.keys(this.specInJson['x-ms-paths']).length > 0) {
      let paths = this.specInJson.paths;
      for (let property in this.specInJson['x-ms-paths']) {
        paths[property] = this.specInJson['x-ms-paths'][property];
      }
      this.specInJson.paths = paths;
    }
  }

  simpleValidateModel(modelReference, model) {
    let self = this;
    console.log(modelReference);
    let result = validateModel(self.specInJson, modelReference, model);
    console.log(result);
    return;
  }

  //wrapper to validateModel of swagger-tools
  validateModelsss(modelReference, data) {
    let self = this;
    if (!modelReference) {
      throw new Error('modelReference cannot be null or undefined. It must be of a string. Example: "#/definitions/foo".');
    }
    if (!data) {
      throw new Error('data cannot be null or undefined. It must be of a JSON object or a JSON array.');
    }

    return function (callback) {
      swt.validateModel(self.specInJson, modelReference, data, callback);
    }
  }

  validateDateTypes(schema, value) {
    if (value !== null && value !== undefined) {
      if (schema.format.match(/^date$/ig) !== null) {
        if (!(value instanceof Date ||
          (typeof value.valueOf() === 'string' && !isNaN(Date.parse(value))))) {
          throw new Error(`${schema.name} must be an instanceof Date or a string in ISO8601 format.`);
        }
      } else if (schema.format.match(/^date-time$/ig) !== null) {
        if (!(value instanceof Date ||
          (typeof value.valueOf() === 'string' && !isNaN(Date.parse(value))))) {
          throw new Error(`${schema.name} must be an instanceof Date or a string in ISO8601 format.`);
        }
      } else if (schema.format.match(/^date-time-rfc-1123$/ig) !== null) {
        if (!(value instanceof Date ||
          (typeof value.valueOf() === 'string' && !isNaN(Date.parse(value))))) {
          throw new Error(`${schema.name} must be an instanceof Date or a string in RFC-1123 format.`);
        }
      } else if (schema.format.match(/^unixtime$/ig) !== null) {
        if (!(value instanceof Date ||
          (typeof value.valueOf() === 'string' && !isNaN(Date.parse(value))))) {
          throw new Error(`${schema.name} must be an instanceof Date or a string in RFC-1123/ISO8601 format ` +
            `for it to be serialized in UnixTime/Epoch format.`);
        }
      } else if (schema.format.match(/^(duration|timespan)$/ig) !== null) {
        if (!moment.isDuration(value)) {
          throw new Error(`${schema.name} must be a TimeSpan/Duration.`);
        }
      }
    }
  }

  validateBufferType(schema, value) {
    if (value !== null && value !== undefined) {
      if (!Buffer.isBuffer(value)) {
        throw new Error(`${schema.name} must be of type Buffer.`);
      }
    }
  }

  isValidUuid(uuid) {
    let validUuidRegex = new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$', 'ig');
    return validUuidRegex.test(uuid);
  };

  validateBasicTypes(schema, value) {
    if (value !== null && value !== undefined) {
      if (schema.type.match(/^(number|integer)$/ig) !== null) {
        if (typeof value !== 'number') {
          throw new Error(`${schema.name} with value ${value} must be of type number.`);
        }
      } else if (schema.type.match(/^string$/ig) !== null) {
        if (typeof value.valueOf() !== 'string') {
          throw new Error(`${schema.name} with value '${value}' must be of type string.`);
        }
        if (schema.format && schema.format.match(/^uuid$/ig) !== null) {
          if (!(typeof value.valueOf() === 'string' && this.isValidUuid(value))) {
            throw new Error(`${schema.name} with value '${value}' must be of type string and a valid uuid.`);
          }
        }
      } else if (schema.type.match(/^boolean$/ig) !== null) {
        if (typeof value !== 'boolean') {
          throw new Error(`${schema.name} with value ${value} must be of type boolean.`);
        }
      }
    }
  }

  //entry point for type validations
  validateType(schema, data) {
    if (schema.type.match(/^(number|string|boolean|integer)$/ig) !== null) {
      if (schema.format) {
        if (schema.format.match(/^(date|date-time|timespan|duration|date-time-rfc1123|unixtime)$/ig) !== null) {
          this.validateDateTypes(schema, data);
        } else if (schema.format.match(/^b(yte|ase64url)$/ig) !== null) {
          this.validateBufferType(schema, data);
        }
      } else {
        this.validateBasicTypes(schema, data);
      }
    } else {
      throw new Error(`Unknown type: "${schema.type}" provided for parameter: "${schema.name}".`);
    }
  };

  //validates constraints
  validateConstraints(schema, value, objectName) {
    let constraintErrors = [];
    constraints.forEach(function (constraintType) {
      if (schema[constraintType] !== null && schema[constraintType] !== undefined) {
        if (constraintType.match(/^maximum$/ig) !== null) {
          if (schema['exclusiveMaximum']) {
            if (value >= schema[constraintType]) {
              let msg = `'${objectName}' with value '${value}' should satify the constraint ` +
                `'exclusiveMaximum': true and 'maximum': ${schema[constraintType]}.`;
              let e = utils.constructErrorObject('EXCLUSIVE_MAXIMUM_FAILURE', msg);
              constraintErrors.push(e);
            }
          } else {
            if (value > schema[constraintType]) {
              let msg = `'${objectName}' with value '${value}' should satify the constraint 'maximum': ${schema[constraintType]}.`;
              let e = utils.constructErrorObject('MAXIMUM_FAILURE', msg);
              constraintErrors.push(e);
            }
          }
        } else if (constraintType.match(/^minimum$/ig) !== null) {
          if (schema['exclusiveMinimum']) {
            if (value <= schema[constraintType]) {
              let msg = `'${objectName}' with value '${value}' should satify the constraint ` +
                `'exclusiveMinimum': true and 'minimum': ${schema[constraintType]}.`;
              e.code = 'MINIMUM_FAILURE';
              let e = utils.constructErrorObject('MINIMUM_FAILURE', msg);
              constraintErrors.push(e);
            }
          } else {
            if (value < schema[constraintType]) {
              let msg = `'${objectName}' with value '${value}' should satify the constraint 'minimum': ${schema[constraintType]}.`;
              e.code = 'MINIMUM_FAILURE';
              let e = utils.constructErrorObject('MINIMUM_FAILURE', msg);
              constraintErrors.push(e);
            }
          }
        } else if (constraintType.match(/^maxItems$/ig) !== null) {
          if (value.length > schema[constraintType]) {
            let msg = `'${objectName}' with value '${value}' should satify the constraint 'maxItems': ${schema[constraintType]}.`;
            e.code = 'MAXITEMS_FAILURE';
            let e = utils.constructErrorObject('MAXITEMS_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^maxLength$/ig) !== null) {
          if (value.length > schema[constraintType]) {
            let msg = `'${objectName}' with value '${value}' should satify the constraint 'maxLength': ${schema[constraintType]}.`;
            e.code = 'MAXLENGTH_FAILURE';
            let e = utils.constructErrorObject('MAXLENGTH_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^minItems$/ig) !== null) {
          if (value.length < schema[constraintType]) {
            let msg = `'${objectName}' with value '${value}' should satify the constraint 'minItems': ${schema[constraintType]}.`;
            e.code = 'MINITEMS_FAILURE';
            let e = utils.constructErrorObject('MINITEMS_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^minLength$/ig) !== null) {
          if (value.length < schema[constraintType]) {
            throw `'${objectName}' with value '${value}' should satify the constraint 'minLength': ${schema[constraintType]}.`;
            e.code = 'MINLENGTH_FAILURE';
            let e = utils.constructErrorObject('MINLENGTH_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^multipleOf$/ig) !== null) {
          if (value.length % schema[constraintType] !== 0) {
            let msg = `'${objectName}' with value '${value}' should satify the constraint 'multipleOf': ${schema[constraintType]}.`;
            let e = utils.constructErrorObject('MULTIPLEOF_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^pattern$/ig) !== null) {
          if (value.match(schema[constraintType].split('/').join('\/')) === null) {
            let msg = `'${objectName}' with value '${value}' should satify the constraint 'pattern': ${schema[constraintType]}.`;
            let e = utils.constructErrorObject('REGEX_PATTERN_FAILURE', msg);
            constraintErrors.push(e);
          }
        } else if (constraintType.match(/^uniqueItems/ig) !== null) {
          if (schema[constraintType]) {
            if (value.length !== value.filter(function (item, i, ar) { { return ar.indexOf(item) === i; } }).length) {
              let msg = `'${objectName}' with value '${value}' should satify the constraint 'uniqueItems': ${schema[constraintType]}.`;
              let e = utils.constructErrorObject('UNIQUEITEMS_FAILURE', msg);
              constraintErrors.push(e);
            }
          }
        } else if (constraintType.match(/^enum/ig) !== null) {
          let isPresent = schema[constraintType].some(function (item) {
            return item === value;
          });
          if (!isPresent && schema['x-ms-enum'] && !Boolean(schema['x-ms-enum']['modelAsString'])) {
            let msg = `${value} is not a valid value for ${objectName}. The valid values are: ${JSON.stringify(schema[constraintType])}.`;
            let e = utils.constructErrorObject('ENUM_FAILURE', msg);
            constraintErrors.push(e);
          }
        }
      }
    });
    if (constraintErrors.length > 0) {
      return constraintErrors;
    }
  }

  validateNonBodyParameter(schema, data, operationId) {
    let result = {
      validationErrors: null,
      typeError: null
    };
    //constraint validation
    result.validationErrors = this.validateConstraints(schema, data, schema.name);
    //type validation
    try {
      this.validateType(schema, data);
    } catch (typeError) {
      result.typeError = `${typeError.message} in operation: "${operationId}".`;
    }
    return result;
  }

  validateScenario(apiPath, verb, scenarioName) {
    let self = this;
    let operation = specInJson.paths[apiPath][verb];
    let operationId = operation.operationId;
    let scenarioData = operation[xmsExamples][scenarioName];
    self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters = {};
    for (let l = 0; l < operation.parameters.length; l++) {
      let parameter = operation.parameters[l];
      let dereferencedParameter = parameter;
      if (parameter['$ref']) {
        dereferencedParameter = self.refSpecInJson.get(parameter['$ref']);
      }
      let parameterName = dereferencedParameter.name;
      self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName] = {};
      self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = true;
      //check for requiredness
      if (dereferencedParameter.required && !scenarioData.parameters[parameterName]) {
        let msg = `Swagger spec has a parameter named "${dereferencedParameter.name}" as required for operation "${operationId}", ` + 
          `however this parameter is not defined in the example for scenario "${scenarioName}".`;
        self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = false;
        let reqError = utils.constructErrorObject(RequiredParameterNotInExampleError, msg);
        self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = reqError;
        console.error(`\t\t\t\t> ${reqError.code}: ${reqError.message}`);
        continue;
      }
      if (dereferencedParameter.in === 'body') {
        //TODO: Handle inline model definition
        let modelReference = dereferencedParameter.schema['$ref'];
        try {
          let bodyValidationResult = null;
          let bodyValidationDone = false
          swt.validateModel(self.specInJson, modelReference, scenarioData.parameters[parameterName], function (err, result) {
            bodyValidationResult
          });
          if (result) {
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = false;
            let msg = `Found errors in validating the body parameter for example "${scenarioName}" in operation "${operationId}".`;
            let bodyValidationError = utils.constructErrorObject(BodyParameterValidationError, msg, result.errors);
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = bodyValidationError;
            console.error(`\t\t\t\t> ${bodyValidationError.code}: ${bodyValidationError.message}`);
          } else {
            let msg = `The body parameter for example "${scenarioName}" in operation "${operationId}" is valid.`;
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['result'] = msg;
            console.log(`\t\t\t\t> ${BodyParameterValid}: ${msg}`);
          }
        } catch(err) {
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = false;
          let msg = `An internal error occured while validating the body parameter for example "${scenarioName}" in operation "${operationId}".`;
          let e = utils.constructErrorObject(InternalError, msg, [err]);
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = e;
          console.error(`\t\t\t\t> ${e.code}: ${e.message}`);
        }
      } else {
        let errors = self.validateNonBodyParameter(dereferencedParameter, scenarioData.parameters[parameterName], operationId);
        let nonBodyError;
        if (errors.validationErrors) {
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = false;
          let msg = `${parameterName} in operation ${operationId} failed validation constraints.`;
          nonBodyError = utils.constructErrorObject(ConstraintValidationError, msg, errors.validationErrors);
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = nonBodyError;
          console.log(`\t\t\t\t> ${nonBodyError.code}: ${nonBodyError.message}`);
        }
        if (errors.typeError) {
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName]['isValid'] = false;
          errors.typeError.code = TypeValidationError;
          if (errors.validationErrors) {
            nonBodyError.code += ' + ' + errors.typeError.code
            nonBodyError.innerErrors.push(errors.typeError);
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = nonBodyError;
            console.log(`\t\t\t\t> ${nonBodyError.code}: ${nonBodyError.message}`);
          } else {
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters[parameterName].error = errors.typeError;
            console.log(`\t\t\t\t> ${errors.typeError.code}: ${errors.typeError.message}`);
          }
        }
      }
    }

    //validate responses
    self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses = {};
    let res = Object.keys(operation.responses);
    for (let m = 0; m < res.length; m++) {
      let statusCode = res[m];
      self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode] = {};
      self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode]['isValid'] = true;
      if (!scenarioData.responses[statusCode]) {
        let msg = `Response with statusCode "${statusCode}" for operation "${operationId}" is present in the spec, but not in the example "${scenarioName}".`;
        let e = utils.constructErrorObject(StatuscodeNotInExampleError, msg);
        self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode]['isValid'] = false;
        self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode].error = e;
        continue;
      }
      //TODO: Currently only validating $ref in responses. What if it is an inline schema? Will have to add the logic to 
      //add the schema in the definitions section and replace the inline schema with a ref corresponding to that definition.
      if (operation.responses[statusCode]['schema'] && operation.responses[statusCode]['schema']['$ref']) {
        let modelReference = operation.responses[statusCode]['schema']['$ref'];
        try {
          let result = self.validateModel(modelReference, scenarioData.responses[statusCode].body);
          if (result) {
            let msg = `Found errors in validating the response with statusCode "${statusCode}" for ` + 
            `example "${scenarioName}" in operation "${operationId}".`;
            let responseBodyValidationError = utils.constructErrorObject(ResponseBodyValidationError, msg, result.errors);
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode]['isValid'] = false;
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode].error = responseBodyValidationError;
            console.error(`\t\t\t\t> ${responseBodyValidationError.code}: ${responseBodyValidationError.message}`);
          } else {
            let msg = `Response with statusCode "${statusCode}" for example "${scenarioName}" in operation "${operationId}" is valid.`
            self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode]['result'] = msg;
            console.log(`\t\t\t\t> RESPONSE_${statusCode}_VALID: ${msg}`);
          }
        } catch(err) {
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode]['isValid'] = false;
          err.code = InternalError + (err.code ? ' ' + err.code : '');
          let msg = `An internal error occured while validating the response with statusCode "${statusCode}" for ` + 
            `example "${scenarioName}" in operation "${operationId}".`;
          let e = utils.constructErrorObject(InternalError, msg, [err]);
          self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].responses[statusCode].error = e;
          console.log(`\t\t\t\t> ${e.code}: ${e.message}`);
        }
      }
    }
  }

  validateDataModels() {
    let self = this;
    utils.run(function* () {
      let apiPaths = Object.keys(self.specInJson.paths);
      for (let i = 0; i < apiPaths.length; i++) {
        let verbs = Object.keys(self.specInJson.paths[apiPaths[i]]);
        for (let j = 0; j < verbs.length; j++) {
          let apiPath = apiPaths[i], verb = verbs[j];
          let operation = self.specInJson.paths[apiPath][verb];
          let operationId = operation.operationId;
          console.log(`\t> Operation: ${operationId}`);
          if (operation[xmsExamples]) {
            let scenarios = Object.keys(operation[xmsExamples]);
            for (let k = 0; k < scenarios.length; k++) {
              let scenarioName = scenarios[k], scenarioData = operation[xmsExamples][scenarioName];
              //validate parameters
              console.log(`\t\t> ${xmsExamples}`);
              console.log(`\t\t\t> Scenario: ${scenarioName}`);
              self.specValidationResult.operations[operationId][xmsExamples]['scenarios'][scenarioName].parameters = {};
              self.validateScenario(apiPath, verb, scenarioName)
            }

            //validate examples present in the spec if present
            //let's validate the example for body parameter if it is present
            let parameters = operation.parameters;
            let exampleDisplay = false;
            if (parameters) {
              for (let p = 0;  p < parameters.length; p++) {
                let param = parameters[p];
                if (param && param.in && param.in === 'body') {
                  //TODO: Need to handle inline parameters
                  if (param.schema && param.schema['$ref']) {
                    let paramRef = param.schema['$ref'];
                    let dereferencedParam = self.refSpecInJson.get(paramRef);
                    if (dereferencedParam.example) {
                      console.log(`\t\t> ${exampleInSpec}`);
                      exampleDisplay = true;
                      self.specValidationResult.operations[operationId][exampleInSpec] = {};
                      self.specValidationResult.operations[operationId][exampleInSpec]['parameters'] = {};
                      self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name] = {};
                      self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name]['isValid'] = true;
                      try {
                        let bodyParamExampleResult = yield self.validateModel(paramRef, dereferencedParam.example);
                        if (bodyParamExampleResult) {
                          self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name]['isValid'] = false;
                          let msg = `Found errors in validating the example provided for body parameter ` + 
                            `${param.name} with reference ${paramRef} in operation "${operationId}".`;
                          let bodyValidationError = utils.constructErrorObject(BodyParameterValidationError, msg, bodyParamExampleResult.errors);
                          self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name]['error'] = bodyValidationError;
                          console.error(`\t\t\t> ${bodyValidationError.code}: ${bodyValidationError.message}`);
                        } else {
                          let msg = `The example for body parameter ${param.name} with reference ${paramRef} in operation "${operationId}" is valid.`;
                          self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name]['result'] = msg;
                          console.log(`\t\t\t> ${BodyParameterValid}: ${msg}`);
                        }
                      } catch(err) {
                        self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name]['isValid'] = false;
                        err.code = InternalError + (err.code ? ' ' + err.code : '');
                        let msg = `An internal error occured while validating the example provided for body parameter ` + 
                          `${param.name} with reference ${paramRef} in operation "${operationId}".`;
                        let e = utils.constructErrorObject(InternalError, msg, [err]);
                        self.specValidationResult.operations[operationId][exampleInSpec]['parameters'][param.name].error = e;
                        console.error(`\t\t\t> ${e.code}: ${e.message}`);
                      }
                    }
                  }
                }
              }
            }
            //let's validate the examples for response status codes if present
            let responses = operation.responses;
            let statusCodes = Object.keys(responses);
            if (statusCodes) {
              for(let q = 0; q < statusCodes.length; q++) {
                if (responses[statusCodes[q]].examples) {
                  if (!exampleDisplay) {
                    console.log(`\t\t> ${exampleInSpec}`);
                    if (!self.specValidationResult.operations) {
                      self.specValidationResult.operations = {};
                      self.specValidationResult.operations[operationId] = {};
                    }
                    self.specValidationResult.operations[operationId][exampleInSpec] = {};
                  }
                  let responseExamples = responses[statusCodes[q]].examples;
                  //TODO: Handle the case for inline schema definitions.
                  let responseRef;
                  if (responses[statusCodes[q]].schema && responses[statusCodes[q]].schema['$ref']) {
                    responseRef = responses[statusCodes[q]].schema['$ref'];
                  }
                  let mimeTypes = Object.keys(responseExamples);
                  for (let r = 0; r < mimeTypes.length; r++) {
                    let responseData = responseExamples[mimeTypes[r]];
                    self.specValidationResult.operations[operationId][exampleInSpec]['responses'] = {};
                    self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]] = {};
                    self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]]['isValid'] = true;
                    try {
                      let responseResult = yield self.validateModel(responseRef, responseData);
                      if (responseResult) {
                        let msg = `Found errors in validating the example for response with statusCode "${statusCodes[q]}" in operation "${operationId}".`;
                        let responseBodyValidationError = utils.constructErrorObject(ResponseBodyValidationError, msg, responseResult.errors);
                        self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]]['isValid'] = false;
                        self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]].error = responseBodyValidationError;
                        console.log(`\t\t\t> ${responseBodyValidationError.code}: ${responseBodyValidationError.message}`);
                      } else {
                        let msg = `The example for response with statusCode "${statusCodes[q]}" in operation "${operationId}" is valid.`
                        self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]]['result'] = msg;
                        console.log(`\t\t\t> RESPONSE_${statusCodes[q]}_VALID: ${msg}`);
                      }
                    } catch(err) {
                      self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]]['isValid'] = false;
                      let msg = `An internal error occured while validating the example for response with statusCode "${statusCodes[q]}" in operation "${operationId}".`;
                      let e = utils.constructErrorObject(InternalError, msg, [err]);
                      self.specValidationResult.operations[operationId][exampleInSpec]['responses'][statusCodes[q]].error = e;
                      console.log(`\t\t\t> ${e.code}: ${e.message}`);
                    }
                  }
                }
              }
            }
          }
        }
      }
      return callback(null);
    });
  }

  validateSpec() {
    let self = this;
    let validationResult;
    try {
      let done = false;
      swt.validate(self.specInJson, function (err, result) {
        if (err) { throw err; }
        validationResult = result;
        done = true;
      });
      deasync.loopWhile(function () { return !done; });
    } catch (err) {
      throw err;
    }
    console.dir(validationResult, { depth: null, colors: true });
    return validationResult;
  }
}

module.exports = SpecValidator;