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
const EnforcerRef   = require('./enforcer-ref');
const util          = require('./util');

const rxExtension = /^x-.+/;

module.exports = normalize;

function childData(parent, key, validator) {
    const definition = parent.definition[key];

    const definitionType = util.getDefinitionType(definition);
    let result;

    if (definitionType === 'array') {
        result = [];
    } else if (definitionType === 'object') {
        result = {};
    } else {
        result = definition;
    }

    return {
        context: parent.context,
        definition,
        definitionType,
        exception: parent.exception.at(key),
        key,
        major: parent.major,
        map: parent.map,
        minor: parent.minor,
        parent,
        patch: parent.patch,
        plugins: parent.plugins,
        result,
        root: parent.root,
        validator,
        warn: parent.warn.at(key),
    };
}

function normalize (data) {
    const { definitionType, exception, map, result } = data;
    let definition = data.definition;

    try {
        // generate the plain validator object
        const validator = fn(data.validator, data);

        // if type is invalid then exit
        if (!validateType(definitionType, data)) return;

        // if the value has already been processed then we are in a circular reference and we should return the known value
        if (definition && typeof definition === 'object') {
            const existing = map.get(definition);
            if (existing) return existing;
            map.set(definition, result);
        }

        // if enum is invalid then exit
        if (validator.enum) {
            const matches = fn(validator.enum, data);
            if (!matches.includes(definition)) {
                matches.length === 1
                    ? exception.message('Value must be ' + util.smart(matches[0]) + '. Received: ' + util.smart(definition))
                    : exception.message('Value must be one of: ' + matches.join(', ') + '. Received: ' + util.smart(definition));
            }
        }

        if (definitionType === 'array') {
            definition.forEach((def, i) => {
                const child = childData(data, i, validator.items);
                result.push(runChildValidator(child));
            });

        } else if (definitionType === 'object') {
            const missingRequired = [];
            const notAllowed = [];
            const unknownKeys = [];

            if (validator === true) {
                Object.assign(result, util.copy(definition));

            } else if (validator === false) {
                notAllowed.push.apply(notAllowed, Object.keys(definition));

            } else if (validator.additionalProperties) {
                Object.keys(definition).forEach(key => {
                    const child = childData(data, key, validator.additionalProperties);
                    const keyValidator = EnforcerRef.isEnforcerRef(child.validator)
                        ? child.validator.config || {}
                        : child.validator;

                    const allowed = keyValidator.hasOwnProperty('allowed') ? fn(keyValidator.allowed, child) : true;
                    let valueSet = false;
                    if (child.definition !== undefined) {
                        if (!allowed) {
                            notAllowed.push(key);
                        } else if (!keyValidator.ignored || !fn(keyValidator.ignored, child)) {
                            result[key] = runChildValidator(child);
                            valueSet = true;
                        }
                    }

                    if (valueSet && keyValidator.errors) {
                        const d = Object.assign({}, child);
                        d.definition = result[key];
                        fn(keyValidator.errors, d);
                    }
                });

            } else {

                // organize definition properties
                Object.keys(definition).forEach(key => {
                    if (rxExtension.test(key)) {
                        result[key] = definition[key];
                    } else {
                        unknownKeys.push(key);
                    }
                });

                // get sorted array of all properties to use
                const properties = Object.keys(validator.properties || {})
                    .map(key => {
                        const property = validator.properties[key];
                        util.arrayRemoveItem(unknownKeys, key);
                        return {
                            data: childData(data, key, property),
                            weight: property.weight || 0
                        }
                    });
                properties.sort((a, b) => {
                    if (a.weight < b.weight) return -1;
                    if (a.weight > b.weight) return 1;
                    return a.data.key < b.data.key ? -1 : 1;
                });

                // iterate through all known properties
                properties.forEach(prop => {
                    const data = prop.data;
                    const key = data.key;
                    const validator = data.validator;
                    const keyValidator = EnforcerRef.isEnforcerRef(validator)
                        ? validator.config || {}
                        : validator;
                    const allowed = keyValidator.hasOwnProperty('allowed') ? fn(keyValidator.allowed, data) : true;

                    // set default value
                    if (data.definition === undefined && allowed && validator.hasOwnProperty('default')) {
                        data.definition = fn(validator.default, data);
                        data.definitionType = util.getDefinitionType(data.definition);
                    }

                    if (data.definition !== undefined) {
                        if (!allowed) {
                            notAllowed.push(key);
                        } else if (!keyValidator.ignored || !fn(keyValidator.ignored, data)) {
                            result[key] = runChildValidator(data);
                        }
                    } else if (allowed && keyValidator.required && fn(keyValidator.required, data)) {
                        missingRequired.push(key);
                    }
                });
            }

            // report any keys that are not allowed
            notAllowed.push.apply(notAllowed, unknownKeys);
            if (notAllowed.length) {
                exception.message('Propert' + (notAllowed.length === 1 ? 'y' : 'ies') + ' not allowed: ' + notAllowed.join(', '));
            }

            // report missing required properties
            if (missingRequired.length) {
                exception.message('Missing required propert' + (missingRequired.length === 1 ? 'y' : 'ies') + ': ' + missingRequired.join(', '));
            }

        } else {
            switch (definitionType) {
                case 'boolean':
                case 'number':
                case 'string':
                    data.result = definition;
                    break;
                default:
                    exception('Unknown data type provided');
                    break;
            }
        }

        // run custom error validation check
        if (validator.errors) {
            const d = Object.assign({}, data);
            d.definition = data.result;
            fn(validator.errors, d);
        }

    } catch (err) {
        exception.message('Unexpected error encountered: ' + err.stack);
    }

    return data.result;
}

normalize.isValidatorState = function (value) {
    return value instanceof ValidatorState
};

function expectedTypeMessage(type) {
    if (type === 'array') return 'an array';
    if (type === 'object') return 'a plain object';
    return 'a ' + type;
}

function fn(value, params) {
    if (typeof value === 'function') {
        try {
            return value(params);
        } catch (err) {
            params.exception.message('Unexpected error encountered: ' + err.stack);
        }
    } else {
        return value;
    }
}

function runChildValidator(data) {
    const validator = fn(data.validator, data);
    data.validator = validator;
    if (EnforcerRef.isEnforcerRef(validator)) {
        if (data.definitionType === 'boolean') {     // account for boolean instead of schema definition
            data.validator = data.validator.config;
            return normalize(data);
        } else if (data.definitionType === 'object') {
            return new data.context[validator.value](new ValidatorState(data));
        } else {
            data.exception.message('Value must be a plain object');
        }
    } else if (data.validator) {
        return normalize(data);
    } else {
        return data.result;
    }
}

function validateType(definitionType, data) {
    const { definition, exception, validator } = data;
    if (validator.type && definition !== undefined) {
        // get valid types
        let matches = fn(validator.type, data);
        if (!Array.isArray(matches)) matches = [ matches ];

        // check if types match
        if (matches.includes(definitionType)) return true;

        const length = matches.length;
        let message;
        if (length === 1) {
            message = expectedTypeMessage(matches[0]);
        } else if (length === 2) {
            message = expectedTypeMessage(matches[0]) + ' or ' + expectedTypeMessage(matches[1])
        } else {
            const last = matches.pop();
            message = matches.map(match => expectedTypeMessage(match)).join(', ') + ', or ' + expectedTypeMessage(last);
        }
        exception.message('Value must be ' + message + '. Received: ' + util.smart(definition));
        return false;
    } else {
        return true;
    }
}

function ValidatorState (data) {
    Object.assign(this, data);
}