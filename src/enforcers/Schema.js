/**
 *  @license
 *    Copyright 2018 Brigham Young University
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 **/
'use strict';
const EnforcerRef       = require('../enforcer-ref');
const Exception         = require('../exception');
const Result            = require('../result');
const runDeserialize    = require('../schema/deserialize');
const runPopulate       = require('../schema/populate');
const runRandom         = require('../schema/random');
const runSerialize      = require('../schema/serialize');
const runValidate       = require('../schema/validate');
const util              = require('../util');
const Value             = require('../schema/value');

const freeze = util.freeze;
const rxHttp = /^https?:\/\//;
const populateInjectors = {
    colon: buildInjector(() => /:([_$a-z][_$a-z0-9]*)/ig),
    doubleHandlebar: buildInjector(() => /{{([_$a-z][_$a-z0-9]*)}}/ig),
    handlebar: buildInjector(() => /{([_$a-z][_$a-z0-9]*)}/ig)
};

const prototype = {

    /**
     * Take a serialized (ready for HTTP transmission) value and deserialize it.
     * Converts strings of binary, byte, date, and date-time to JavaScript equivalents.
     * @param {*} value
     * @returns {EnforcerResult<*>}
     */
    deserialize: function(value) {
        const exception = Exception('Unable to deserialize value');
        const result = runDeserialize(exception, new Map(), this, util.copy(value));
        return new Result(result, exception);
    },

    /**
     * Get discriminator key and schema.
     * @param {*} value
     * @param {boolean=false} details
     * @returns {Schema|{ key:string, name:string, schema:Schema }}
     */
    discriminate: function (value, details) {
        const { major, root } = this.enforcerData;
        const discriminator = this.discriminator;
        const openapi = root.result;
        let key;
        let name;
        let schema;

        if (!discriminator) return undefined;

        if (major === 2) {
            key = discriminator;
            name = discriminator && value && value.hasOwnProperty(discriminator) ? value[discriminator] : undefined;
            if (name) schema = openapi.definitions && openapi.definitions[name];

        } else if (major === 3) {
            key = discriminator.propertyName;
            name = discriminator && value && value.hasOwnProperty(discriminator.propertyName) ? value[discriminator.propertyName] : undefined;
            if (name) {
                const mapping = discriminator.mapping;
                schema = mapping && mapping.hasOwnProperty(name)
                    ? mapping[name]
                    : openapi.components && openapi.components.schemas && openapi.components.schemas[name];
            }
        }
        return details
            ? { key, name, schema }
            : schema;
    },

    /**
     * Take a non plain object and convert it into a plain object far enough so that validation and serialization can occur.
     * @param {*} value
     * @returns {*}
     */
    formalize: function (value) {
        return this.enforcerData.context.Schema.formalize(value);
    },

    /**
     * Populate a value from a list of parameters.
     * @param {object} [params]
     * @param {*} [value]
     * @param {object} [options]
     * @param {boolean} [options.copy=false]
     * @param {boolean} [options.conditions=true]
     * @param {boolean} [options.defaults=true]
     * @param {number} [options.depth=100]
     * @param {string} [options.replacement='handlebar']
     * @param {boolean} [options.templateDefaults=true]
     * @param {boolean} [options.templates=true]
     * @param {boolean} [options.variables=true]
     * @returns {EnforcerResult<*>}
     */
    populate: function(params, value, options = {}) {
        if (params === undefined || params === null) params = {};
        if (!params || !util.isPlainObject(params)) throw Error('Invalid params specified. Must be a plain object');

        if (!options || !util.isPlainObject(options)) throw Error('Invalid options specified. Must be a plain object');
        if (!options.hasOwnProperty('copy')) options.copy = false;
        if (!options.hasOwnProperty('conditions')) options.conditions = true;
        if (!options.hasOwnProperty('defaults')) options.defaults = true;
        if (!options.hasOwnProperty('depth')) options.depth = 100;
        if (!options.hasOwnProperty('replacement')) options.replacement = 'handlebar';
        if (!options.hasOwnProperty('templateDefaults')) options.templateDefaults = true;
        if (!options.hasOwnProperty('templates')) options.templates = true;
        if (!options.hasOwnProperty('variables')) options.variables = true;

        if (!util.isInteger(options.depth) || options.depth < 0) {
            throw Error('Invalid depth specified. Expected a non-negative integer');
        }
        if (!populateInjectors.hasOwnProperty(options.replacement)) {
            throw Error('Invalid replacement type specified. Expected one of: ' + Object.keys(populateInjectors).join(', '));
        }

        options.injector = populateInjectors[options.replacement];
        if (!params) params = {};
        if (options.copy) value = util.copy(value);
        const root = { value };

        // validate the value
        const exception = Exception('Unable to populate value');
        const warn = Exception('One or more warnings found while populating value');
        runPopulate(exception, warn, options.depth - 1, this, params, root, 'value', options);

        return new Result(root.value, exception, warn);
    },

    /**
     * Produce a random value for the schema.
     * @param {*} [value] An initial value to add random values to.
     * @param {object} [options]
     * @param {number} [options.additionalPropertiesPossibility=0]
     * @param {number} [options.arrayVariation=4]
     * @param {boolean} [options.copy=false]
     * @param {number} [options.defaultPossibility=.25]
     * @param {number} [options.definedPropertyPossibility=.80]
     * @param {number} [options.maxDepth=10]
     * @param {number} [options.numberVariation=1000]
     * @param {number} [options.uniqueItemRetry=5]
     * @returns {EnforcerResult<*>}
     */
    random: function (value, options = {}) {
        if (!options || !util.isPlainObject(options)) throw Error('Invalid options specified. Must be a plain object');
        if (!options.hasOwnProperty('additionalPropertiesPossibility')) options.additionalPropertiesPossibility = 0;
        if (!options.hasOwnProperty('arrayVariation')) options.arrayVariation = 4;
        if (!options.hasOwnProperty('copy')) options.copy = false;
        if (!options.hasOwnProperty('defaultPossibility')) options.defaultPossibility = .25;
        if (!options.hasOwnProperty('definedPropertyPossibility')) options.definedPropertyPossibility = .80;
        if (!options.hasOwnProperty('maxDepth')) options.maxDepth = 10;
        if (!options.hasOwnProperty('numberVariation')) options.numberVariation = 1000;
        if (!options.hasOwnProperty('uniqueItemRetry')) options.uniqueItemRetry = 5;

        if (options.additionalPropertiesPossibility < 0 || options.additionalPropertiesPossibility > 1) throw Error('The option "additionalPropertiesPossibility" must be between 0 and 1 inclusive');
        if (options.defaultPossibility < 0 || options.defaultPossibility > 1) throw Error('The option "defaultPossibility" must be between 0 and 1 inclusive');
        if (options.definedPropertyPossibility < 0 || options.definedPropertyPossibility > 1) throw Error('The option "definedPropertyPossibility" must be between 0 and 1 inclusive');

        const exception = Exception('Unable to generate random value');
        const warn = Exception('One or more warnings found while generating random value');
        const root = { root: options.copy ? util.copy(value) : value };
        runRandom(exception, warn, new Map(), this, root, 'root', options, 0);
        return new Result(root.root, exception, warn);
    },

    /**
     * Take a deserialized (not ready for HTTP transmission) value and serialize it.
     * Converts Buffer and Date objects into string equivalent.
     * @param value
     * @returns {EnforcerResult<*>}
     */
    serialize: function (value) {
        const exception = Exception('Unable to serialize value');
        const result = runSerialize(exception, new Map(), this, util.copy(value));
        return new Result(result, exception);
    },

    /**
     * Check to see if the value is valid for this schema.
     * @param {*} value
     * @returns {EnforcerException|undefined}
     */
    validate: function(value) {
        const exception = Exception('Invalid value');
        runValidate(exception, new Map(), this, value, {});
        if (exception.hasException) return exception;
    }
};

module.exports = {
    init: function (data) {
        const { exception, major, plugins, refParser, staticData, warn } = data;

        // deserialize and validate enum, default, and example
        if (this.hasOwnProperty('enum')) {
            const child = exception.at('enum');
            const value = this.enum.map((value, index) => {
                return deserializeAndValidate(this, child.at(index), value, { enum: false });
            });
            Object.freeze(value);
            setProperty(this, 'enum', value);
        }
        if (this.hasOwnProperty('default')) {
            const value = deserializeAndValidate(this, exception.at('default'), this.default, {});
            setProperty(this, 'default', freeze(value));
        }
        if (this.hasOwnProperty('example')) {
            const value = deserializeAndValidate(this, warn.at('example'), this.example, {});
            setProperty(this, 'example', freeze(value));
        }

        // run data type validator
        const dataTypes = staticData.dataTypes;
        const dataType = (dataTypes && dataTypes[this.type] && dataTypes[this.type][this.format]) || null;
        if (dataType && dataType.validator) dataType.validator.call(this, data);

        // if there is a discriminator with mappings then resolve those references
        const discriminator = this.discriminator;
        if (major === 3 && refParser && discriminator && discriminator.mapping) {
            plugins.push(() => {
                const instanceMap = this.enforcerData.defToInstanceMap;
                Object.keys(discriminator.mapping).forEach(key => {
                    const value = discriminator.mapping[key];
                    const ref = rxHttp.test(value) || value.indexOf('/') !== -1
                        ? value
                        : '#/components/schemas/' + value;
                    const definition = refParser.$refs.get(ref);
                    setProperty(discriminator.mapping, key, instanceMap.get(definition));
                });
            });
        }
    },

    prototype,

    statics: function (scope) {
        const warnings = {};
        const constructors = new Set();
        const dataTypes = scope.dataTypes = {
            boolean: {},
            integer: {},
            number: {},
            string: {}
        };
        scope.dataTypeConstructors = function () {
            return Array.from(constructors.values());
        };
        return {
            defineDataTypeFormat: function (type, format, definition) {
                // validate input parameters
                if (!dataTypes.hasOwnProperty(type)) throw Error('Invalid type specified. Must be one of: ' + Object.keys(dataTypes).join(', '));
                if (!format || typeof format !== 'string') throw Error('Invalid format specified. Must be a non-empty string');
                if (dataTypes.hasOwnProperty(format)) throw Error('Format "' + format + '" is already defined');

                if (definition !== null) {
                    if (typeof definition !== 'object' ||
                        typeof definition.deserialize !== 'function' ||
                        typeof definition.serialize !== 'function' ||
                        typeof definition.validate !== 'function'
                        || (definition.random &&  typeof definition.random !== 'function')) throw Error('Invalid data type definition. Must be an object that defines handlers for "deserialize", "serialize", and "validate" with optional "random" handler.');

                    if (definition.constructors) {
                        definition.constructors.forEach(fn => {
                            if (typeof fn !== 'function') throw Error('Invalid constructor specified. Expected a function, received: ' + fn);
                            constructors.add(fn);
                        })
                    } else {
                        const key = type + '-' + format;
                        if (!warnings[key]) {
                            warnings[key] = true;
                            console.warn('WARNING: Data type definition missing recommended "constructors" property for type "' + type + '" and format "' + format + '".');
                        }
                    }
                }

                // store the definition
                dataTypes[type][format] = Object.assign({}, definition, { type, format });
            },

            extractValue: Value.extract,

            formalize: function (value) {
                return util.toPlainObject(value, {
                    preserve: scope.dataTypeConstructors()
                });
            },

            Value: Value
        }
    },

    validator: function (data) {
        const { major } = data;

        const exclusive = {
            allowed: ({ parent }) => {
                return numericish(parent.result);
            },
            type: 'boolean'
        };

        const maxOrMin = {
            weight: -8,
            allowed: ({ parent }) => numericish(parent.result),
            type: ({ parent }) => numericType(parent.result),
            deserialize: ({ exception, parent, result }) => {
                const value = runDeserialize(exception, new Map(), parent.result, result);
                return exception.hasException ? result : value;
            },
            errors: ({ exception, parent, result }) => {
                runValidate(exception, new Map(), parent.result, result, { maxMin: false })
            }
        };

        const maxOrMinItems = {
            allowed: ({ parent }) => parent.definition.type === 'array',
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        const maxOrMinLength = {
            allowed: ({ parent }) => parent.definition.type === 'string' && !numericish(parent.result),
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        const maxOrMinProperties = {
            allowed: ({ parent }) => parent.definition.type === 'object',
            type: 'number',
            errors: ({ exception, result }) => {
                if (!util.isInteger(result) || result < 0) {
                    exception.message('Value must be a non-negative integer');
                }
            }
        };

        return {
            type: 'object',
            properties: {
                additionalProperties: EnforcerRef('Schema', {
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: ['boolean', 'object'],    // either boolean or object
                    default: true
                }),
                allOf: {
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                anyOf: {
                    allowed: ({major}) => major === 3,
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                default: {
                    freeForm: true,
                    type: ({ parent }) => {
                        const def = parent.definition;
                        const types = [ def.type ];
                        if (def.nullable === true || def['x-nullable'] === true) types.push('null');
                        return types;
                    }
                },
                deprecated: {
                    allowed: ({major}) => major === 3,
                    type: 'boolean',
                    default: false
                },
                description: {
                    type: 'string'
                },
                discriminator: {
                    allowed: ({ parent }) => {
                        return parent && parent.validator === module.exports.validator &&
                            (parent.definition.type === 'object' || parent.definition.anyOf || parent.definition.oneOf);
                    },
                    type: ({ major }) => major === 2 ? 'string' : 'object',
                    properties: {
                        propertyName: {
                            type: 'string',
                            required: true,
                            errors: ({ definition, parent }) => {
                                const def = parent.parent.definition;
                                if (def.type === 'object' && (!def.required || !def.required.includes(definition))) {
                                    parent.parent.exception.message('Property "' + definition + '" must be required because it is used as the discriminator property')
                                }
                            }
                        },
                        mapping: {
                            type: 'object',
                            additionalProperties: {
                                type: 'string',
                                errors: ({ exception, parent, refParser, result }) => {
                                    if (refParser) {
                                        let schema;
                                        try {
                                            const ref = rxHttp.test(result) || result.indexOf('/') !== -1
                                                ? result
                                                : '#/components/schemas/' + result;
                                            schema = refParser.$refs.get(ref)
                                        } catch (err) {
                                            exception.message('Reference cannot be resolved: ' + result);
                                        }

                                        if (schema) {
                                            const def = parent.parent.parent.definition;
                                            if (def.anyOf && !def.anyOf.includes(schema)) {
                                                exception.message('Mapping reference must exist in anyOf: ' + result);
                                            } else if (def.oneOf && !def.oneOf.includes(schema)) {
                                                exception.message('Mapping reference must exist in oneOf: ' + result);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    errors: ({ exception, major, parent, definition }) => {
                        if (major === 2) {
                            if (!parent.definition.required || !parent.definition.required.includes(definition)) {
                                exception.message('Value "' + definition + '" must be found in the parent\'s required properties list.');
                            }
                            if (!parent.definition.properties || !parent.definition.properties.hasOwnProperty(definition)) {
                                exception.message('Value "' + definition + '" must be found in the parent\'s properties definition.');
                            }

                        } else if (major === 3 && definition.hasOwnProperty('propertyName') && definition.type === 'object') {
                            if (!parent.definition.required || !parent.definition.required.includes(definition.propertyName)) {
                                exception.message('Value "' + definition.propertyName + '" must be found in the parent\'s required properties list.');
                            }
                            if (!parent.definition.properties || !parent.definition.properties.hasOwnProperty(definition.propertyName)) {
                                exception.message('Value "' + definition.propertyName + '" must be found in the parent\'s properties definition.');
                            }
                        }
                    }
                },
                enum: {
                    weight: -7,
                    type: 'array',
                    items: {
                        allowed: ({ parent }) => !!(parent && parent.parent),
                        type: ({ parent }) => {
                            const def = parent.parent.definition;
                            const types = [ def.type ];
                            if (def.nullable === true || def['x-nullable'] === true) types.push('null');
                            return types;
                        },
                        freeForm: true
                    }
                },
                example: {
                    allowed: true,
                    freeForm: true
                },
                exclusiveMaximum: exclusive,
                exclusiveMinimum: exclusive,
                externalDocs: EnforcerRef('ExternalDocumentation'),
                format: {
                    weight: -9,
                    allowed: ({ parent }) => ['boolean', 'integer', 'number', 'string'].includes(parent.definition.type),
                    type: 'string',
                    errors: ({ parent, warn }) => {
                        const format = parent.definition.format;
                        if (format) {
                            const type = parent.definition.type;
                            const dataTypes = parent.staticData.dataTypes;
                            const formats = dataTypes[type];
                            const enums = formats ? Object.keys(formats) : [];
                            if (!enums.includes(format)) warn.message('Non standard format "' + format + '" used for type "' +  type + '"');
                        }
                    }
                },
                items: EnforcerRef('Schema', {
                    allowed: ({parent}) => {
                        return parent.definition.type === 'array'
                    },
                    required: ({ parent }) => parent.definition.type === 'array'
                }),
                maximum: maxOrMin,
                maxItems: maxOrMinItems,
                maxLength: maxOrMinLength,
                maxProperties: maxOrMinProperties,
                minimum: maxOrMin,
                minItems: maxOrMinItems,
                minLength: maxOrMinLength,
                minProperties: maxOrMinProperties,
                multipleOf: {
                    allowed: ({ parent }) => ['integer', 'number'].includes(parent.definition.type),
                    type: 'number'
                },
                not: EnforcerRef('Schema', { allowed: major === 3 }),
                nullable: {
                    allowed: ({major}) => major === 3,
                    type: 'boolean',
                    default: false
                },
                oneOf: {
                    allowed: ({major}) => major === 3,
                    type: 'array',
                    items: EnforcerRef('Schema')
                },
                pattern: {
                    allowed: ({ parent }) => parent.definition.type === 'string',
                    type: 'string',
                    deserialize: ({ exception, result }) => {
                        if (!result) {
                            exception.message('Value must be a non-empty string');
                            return /./;
                        } else {
                            return new RegExp(result);
                        }
                    },
                    errors: ({ exception, result }) => {
                        if (!result) exception.message('Value must be a non-empty string');
                    }
                },
                properties: {
                    weight: -5,
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: 'object',
                    additionalProperties: EnforcerRef('Schema')
                },
                readOnly: {
                    allowed: isSchemaProperty,
                    type: 'boolean',
                    default: false,
                    errors: ({ major, parent, definition }) => {
                        if (major === 2 && definition && parent && parent.parent && parent.parent.parent && parent.parent.parent.definition.required && parent.parent.parent.definition.required.includes(parent.key)) {
                            parent.warn.message('Property should not be marked as both read only and required');
                        }
                    }
                },
                required: {
                    weight: 1,
                    allowed: ({parent}) => parent.definition.type === 'object',
                    type: 'array',
                    items: 'string',
                    errors: ({ definition, exception, parent }) => {
                        const additionalProperties = parent.definition.additionalProperties;
                        const parentProperties = parent.definition.properties;
                        definition.forEach(key => {
                            if ((!parentProperties || !parentProperties[key]) && !additionalProperties) {
                                exception.at(key).message('Property is listed as required but is not defined in the schema properties and additional properties are not allowed.')
                            }
                        })
                    }
                },
                title: 'string',
                type: {
                    weight: -10,
                    type: 'string',
                    required: ({ parent }) => {
                        const v = parent.definition;
                        return !v.hasOwnProperty('allOf') && !v.hasOwnProperty('anyOf') &&
                            !v.hasOwnProperty('not') && !v.hasOwnProperty('oneOf');
                    },
                    enum: ({ definition, exception, parent }) => {
                        const schemaValidator = module.exports.validator;
                        let allowFile = major === 2;
                        let node = parent.parent;
                        while (allowFile && node) {
                            if (node.validator === schemaValidator) allowFile = false;
                            node = node.parent;
                        }
                        if (definition === 'file' && major === 2 && !allowFile) {
                            exception.message('Value can only be "file" for non-nested schemas')
                        }
                        return allowFile
                            ? ['array', 'boolean', 'file', 'integer', 'number', 'object', 'string']
                            : ['array', 'boolean', 'integer', 'number', 'object', 'string'];
                    }
                },
                uniqueItems: {
                    allowed: ({parent}) => parent.definition.type === 'array',
                    type: 'boolean'
                },
                writeOnly: {
                    allowed: (data) => data.major === 3 && !!isSchemaProperty(data),
                    type: 'boolean',
                    default: false
                },
                xml: EnforcerRef('Xml')
            },

            errors: (data) => {
                const { exception, result } = data;

                if (!minMaxValid(result.minItems, result.maxItems)) {
                    exception.message('Property "minItems" must be less than or equal to "maxItems"');
                }

                if (!minMaxValid(result.minLength, result.maxLength)) {
                    exception.message('Property "minLength" must be less than or equal to "maxLength"');
                }

                if (!minMaxValid(result.minProperties, result.maxProperties)) {
                    exception.message('Property "minProperties" must be less than or equal to "maxProperties"');
                }

                if (result.required && result.hasOwnProperty('maxProperties') && result.required.length > result.maxProperties) {
                    exception.message('There are more required properties than is allows by "maxProperties" contraint');
                }

                if (!minMaxValid(result.minimum, result.maximum, result.exclusiveMinimum, result.exclusiveMaximum)) {
                    const msg = result.exclusiveMinimum || result.exclusiveMaximum ? '' : 'or equal to ';
                    exception.message('Property "minimum" must be less than ' + msg + '"maximum"');
                }

                if (result.hasOwnProperty('properties')) {
                    Object.keys(result.properties).forEach(key => {
                        const v = result.properties[key];
                        if (v.readOnly && v.writeOnly) {
                            exception.at('properties').at(key).message('Cannot be marked as both readOnly and writeOnly');
                        }
                    });
                }

                // validate that zero or one composite has been defined
                const composites = [];
                ['allOf', 'anyOf', 'oneOf', 'not'].forEach(composite => {
                    if (result.hasOwnProperty(composite)) composites.push(composite);
                });
                if (composites.length > 1) {
                    exception.message('Cannot have multiple composites: ' + composites.join(', '));
                }
            }
        };
    }
};

/**
 * Accepts a function that returns a regular expression. Uses the regular expression to extract parameter names from strings.
 * @param {function} rxGenerator
 * @returns {function}
 */
function buildInjector(rxGenerator) {
    return function(value, data) {
        const rx = rxGenerator();
        let match;
        let result = '';
        let offset = 0;
        while ((match = rx.exec(value))) {
            const property = match[1];
            result += value.substring(offset, match.index) + (data[property] !== undefined ? data[property] : match[0]);
            offset = match.index + match[0].length;
        }
        return result + value.substr(offset);
    };
}

function deserializeAndValidate(schema, exception, value, options) {
    let error;
    [ value, error ] = schema.deserialize(value);
    if (!error) {
        const exception = Exception('Invalid value');
        runValidate(exception, new Map(), schema, value, options);
        if (exception.hasException) error = exception;
    }
    if (error) exception.push(error);
    return value;
}

function isSchemaProperty({ parent }) {
    return parent && parent.parent && parent.parent.key === 'properties' &&
        parent.parent.parent && parent.parent.parent.validator === module.exports.validator;
}

function minMaxValid(minimum, maximum, exclusiveMinimum, exclusiveMaximum) {
    if (minimum === undefined || maximum === undefined) return true;
    minimum = +minimum;
    maximum = +maximum;
    return minimum < maximum || (!exclusiveMinimum && !exclusiveMaximum && minimum === maximum);
}

function numericish(schema) {
    if (['number', 'integer'].includes(schema.type)) return true;
    const dataTypes = schema.enforcerData.staticData.dataTypes;
    const dataType = dataTypes[schema.type] && dataTypes[schema.type][schema.format];
    return !!(dataType && dataType.isNumeric);
}

function numericType (schema) {
    const dataTypes = schema.enforcerData.staticData.dataTypes;
    const dataType = dataTypes[schema.type] && dataTypes[schema.type][schema.format];
    if (dataType && dataType.isNumeric) {
        switch (schema.type) {
            case 'boolean':
                return 'boolean';
            case 'string':
                return 'string';
            case 'integer':
            case 'number':
            default:
                return 'number';
        }
    } else {
        return 'number';
    }
}

function setProperty(object, property, value) {
    Object.defineProperty(object, property, {
        configurable: true,
        enumerable: true,
        value
    });
}
