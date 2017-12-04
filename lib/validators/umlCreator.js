// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License. See License.txt in the project root for license information.

'use strict';

var util = require('util'),
  mermaid = require('mermaid'),
  JsonRefs = require('json-refs'),
  utils = require('../util/utils'),
  Constants = require('../util/constants'),
  log = require('../util/logging'),
  ErrorCodes = Constants.ErrorCodes;

/**
 * @class
 * Resolves the swagger spec by unifying x-ms-paths, resolving relative file references if any, 
 * resolving the allof is present in any model definition and then setting additionalProperties 
 * to false if it is not previously set to true or an object in that definition.
 */
class UmlCreator {

  /**
   * @constructor
   * Initializes a new instance of the SpecResolver class.
   * 
   * @param {object} specInJson the parsed spec in json format
   * 
   * @return {object} An instance of the SpecResolver class.
   */
  constructor(specInJson, options) {
    if (specInJson === null || specInJson === undefined || typeof specInJson !== 'object') {
      throw new Error('specInJson is a required property of type object')
    }
    this.specInJson = specInJson;
    this.graphDefinition = `classDiagram\n`;
  }

  generateGraphDefinition() {
    this.generateAllOfGraph();
    this.generateModelPropertiesGraph();
  }

  generateAllOfGraph() {
    let spec = this.specInJson;
    let definitions = spec.definitions;
    for (let modelName in definitions) {
      let model = definitions[modelName];
      if (model.allOf) {
        model.allOf.map((item) => {
          let referencedModel = item;
          let ref = item['$ref'];
          let segments = ref.split('/');
          let parent = segments[segments.length - 1];
          this.graphDefinition += `${parent} <|-- ${modelName} : allOf\n`;
        });
      }
    }
  }

  generateModelPropertiesGraph() {
    let spec = this.specInJson;
    let definitions = spec.definitions;
    for (let modelName in definitions) {
      let model = definitions[modelName];
      let modelProperties = model.properties;
      if (modelProperties) {
        for (let propertyName in modelProperties) {
          let property = modelProperties[propertyName];
          if (property['$ref']) {
            let segments = modelProperties[propertyName]['$ref'].split('/');
            let referencedModel = segments[segments.length - 1];
            this.graphDefinition += `${modelName} --> ${referencedModel}\n`;
          }
          let prefix = `${modelName} : `;
          let propertyType = this.getPropertyType(modelName, property);
          let discriminator = '';
          if (model.discriminator) {
            discriminator = ' discriminator';
          }
          this.graphDefinition += `${prefix}${propertyType} ${propertyName}${discriminator}\n`
        }
      }
    }
  }

  getPropertyType(modelName, property) {
    if (property.type && property.type.match(/^(string|number|boolean)$/i) !== null) {
      return property.type;
    }

    if (property.type === 'array') {
      let result = 'Array<'
      if (property.items) {
        result += this.getPropertyType(modelName, property.items);
      }
      result += '>';
      return result;
    }

    if (property['$ref']) {
      let segments = property['$ref'].split('/');
      let referencedModel = segments[segments.length - 1];
      this.graphDefinition += `${modelName} --> ${referencedModel}\n`;
      return referencedModel;
    }

    if (property.additionalProperties && typeof property.additionalProperties === 'object') {
      let result = 'Dictionary<';
      result += this.getPropertyType(modelName, property.additionalProperties);
      result += '>';
      return result;
    }

    if (property.type === 'object') {
      return 'Object'
    }
    return '';
  }

  generateDiagramFromGraph() {
    this.generateGraphDefinition();
    require('fs').writeFileSync('foo.mmd', this.graphDefinition);
    return new Promise((resolve, reject) => {
      mermaid.render('id', this.graphDefinition, (svgGraph) => {
        console.log(svgGraph);
        resolve(svgGraph);
      });
    });
  }

  generateInheritanceGraph() {
    let self = this;
    let spec = self.specInJson;
    let definitions = spec.definitions;
    let modelNames = Object.keys(definitions);
    let subTreeMap = new Map();

    modelNames.map((modelName) => {
      if (definitions[modelName].allOf) {
        let rootNode = subTreeMap.get(modelName)
        if (!rootNode) {
          rootNode = utils.createInheritanceTree(spec, modelName, subTreeMap, { discriminator: definitions[modelName].discriminator });
        }
        self.updateReferencesWithOneOf(subTreeMap, references);
      }
    });
  }
}

module.exports = UmlCreator;