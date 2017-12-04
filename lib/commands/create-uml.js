// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';
var util = require('util'),
  log = require('../util/logging'),
  validate = require('../validate');

exports.command = 'create-uml <spec-path>';

exports.describe = 'Creates a class diagram of the model definitions in the given swagger spec.';

exports.builder = {
  d: {
    alias: 'outputDir',
    describe: 'Output directory where the class diagram will be stored.',
    string: true,
    default: './'
  }
};

exports.handler = function (argv) {
  log.debug(argv);
  let specPath = argv.specPath;
  let vOptions = {};
  vOptions.consoleLogLevel = argv.logLevel;
  vOptions.logFilepath = argv.f;

  function execCreateUml() {
    return validate.createUml(specPath, argv.d, vOptions);
  }
  execCreateUml();
};

exports = module.exports;