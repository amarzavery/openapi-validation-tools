var Sway = require('sway');
var util = require('util');
var msRest = require('ms-rest');
var HttpRequest = msRest.WebResource;
var options = {};
options.definition = 'https://raw.githubusercontent.com/Azure/azure-rest-api-specs/master/arm-redis/2016-04-01/swagger/redis.json';
options.jsonRefs = {};
options.jsonRefs.relativeBase = 'https://raw.githubusercontent.com/Azure/azure-rest-api-specs/master/arm-redis/2016-04-01/swagger';
var swaggerApi;
Sway.create(options)
  .then(function (api) {
    swaggerApi = api;
    var validationResults = api.validate();
    console.log('>>>> Validating the spec');
    console.dir(validationResults, { depth: null, colore: true });
    var operations = api.getOperations();
    var operation = operations[0];
    var responses = operation.getResponses();
    var resp = { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' } };
    resp.body = operation['x-ms-examples'].RedisCacheCreate.responses[200].body;
    var parameters = operation.getParameters();
    var bodyParameter = parameters[2];
    var req = new HttpRequest();
    var options = {};
    options.pathTemplate = operation.pathObject.path;
    options.method = operation.method;
    options.pathParameters = {
      "name": "cache1",
      "resourceGroupName": "rg1",
      "subscriptionId": "subid",
    };
    options.queryParameters = {
      "api-version": "2016-04-01"
    };
    //options.body = operation['x-ms-examples'].RedisCacheCreate.parameters.parameters;
    options.body = {
      "location": "West US",
      "properties": {
        "sku": {
          "name": "Premium",
          "family": "P",
          "capacity": 1
        },
        "enableNonSslPort": true,
        "shardCount": 2,
        "ShardCount": 2,
        "redisConfiguration": {
          "maxmemory-policy": "allkeys-lru"
        },
        "subnetId": "/subscriptions/subid/resourceGroups/rg2/providers/Microsoft.Network/virtualNetworks/network1/subnets/subnet1",
        "staticIP": "192.168.0.5"
      }
    };
    req = req.prepare(options);
    console.log('>>> Request object');
    console.dir(req, { depth: null, color: true });
    var result = operation.validateRequest(req);
    console.log('requestValidation>>>>>');
    console.dir(result, { depth: null, color: true });
    console.log('>>> Response object');
    console.dir(resp, { depth: null, color: true });
    console.log('>>> Response validation');
    console.dir(operation.validateResponse(resp), {depth: null, color: true})
  }, function (err) {
    console.dir(err, { depth: null });
  });

console.log('Hello');