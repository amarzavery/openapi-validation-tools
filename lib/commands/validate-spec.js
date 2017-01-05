// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';
var util = require('util'), validator,
  validate = require('../../validate');

exports.command = 'validate-spec <spec-path>';

exports.describe = 'Performs semantic validation of the spec.';

exports.handler = function (argv) {
  console.log('>>>>', util.inspect(argv));
  let specPath = argv.specPath;
  if (specPath.match(/.*composite.*/ig) !== null) {
    validate.validateCompositeSpec(specPath);
  } else {
    validate.validateSpec(specPath);
  }
};

exports = module.exports;