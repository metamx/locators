"use strict";

exports.simple = require('./build/simple').simpleLocatorFactory;
exports.request = require('./build/request').requestLocatorFactory;
exports.zookeeper = require('./build/zookeeper').zookeeperLocatorFactory;
exports.EXCEPTION_CODE = require('./build/locatorException').CODE;