// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var log = require('winston'),
  path = require('path'),
  fs = require('fs'),
  utils = require('./utils'),
  logDir = path.resolve(__dirname, '../..', 'output');

var currentLogFile;

// log.add(log.transports.Console, {
//   prettyPrint: true,
//   humanReadableUnhandledException: true
// });

log.add(log.transports.File, {
  level: 'info',
  colorize: false,
  silent: false,
  prettyPrint: true,
  filename: getLogFilePath()
});

//provides the log directory where the logs would reside 
function getLogDir() {
  if(!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
  }
  return logDir;
};

//provides the log file path where logs would be stored
function getLogFilePath() {
  if (!currentLogFile) {
    let filename = `validate_log_${utils.getTimeStamp()}.log`;
    currentLogFile = path.join(getLogDir(), filename);
  }

  return currentLogFile;
}

module.exports = log;