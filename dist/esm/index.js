/* eslint-disable import/no-unresolved */
// @ts-ignore ..
// eslint-disable-next-line no-duplicate-imports
import { Prisma as DefaultPrismaClient } from "@prisma/client";
import get from 'lodash/get';
import set from 'lodash/set';
const relationsByModel = {};
const writeOperationsSupportingNestedWrites = [
    'create',
    'update',
    'upsert',
    'connectOrCreate',
];
const writeOperations = [
    ...writeOperationsSupportingNestedWrites,
    'createMany',
    'updateMany',
    'delete',
    'deleteMany',
];
function isWriteOperation(key) {
    return writeOperations.includes(key);
}
function extractWriteInfo(params, model, argPath) {
    const arg = get(params.args, argPath, {});
    return Object.keys(arg)
        .filter(isWriteOperation)
        .map((operation) => ({
        argPath,
        params: {
            ...params,
            model,
            action: operation,
            args: arg[operation],
            scope: params,
        },
    }));
}
function extractNestedWriteInfo(params, relation) {
    const model = relation.type;
    switch (params.action) {
        case 'upsert':
            return [
                ...extractWriteInfo(params, model, `update.${relation.name}`),
                ...extractWriteInfo(params, model, `create.${relation.name}`),
            ];
        case 'create':
            // nested creates use args as data instead of including a data field.
            if (params.scope) {
                return extractWriteInfo(params, model, relation.name);
            }
            return extractWriteInfo(params, model, `data.${relation.name}`);
        case 'update':
        case 'updateMany':
        case 'createMany':
            return extractWriteInfo(params, model, `data.${relation.name}`);
        case 'connectOrCreate':
            return extractWriteInfo(params, model, `create.${relation.name}`);
        default:
            return [];
    }
}
export function init(prisma) {
    if (!prisma) {
        prisma = DefaultPrismaClient;
    }
    if (!prisma.dmmf) {
        throw new Error('Prisma DMMF not found, please generate Prisma client using `npx prisma generate`');
    }
    prisma.dmmf.datamodel.models.forEach((model) => {
        relationsByModel[model.name] = model.fields.filter((field) => field.kind === "object" && field.relationName);
    });
}
export function createNestedMiddleware(middleware) {
    if (!Object.keys(relationsByModel).length) {
        init();
    }
    const nestedMiddleware = async (params, next) => {
        const relations = relationsByModel[params.model || ''] || [];
        const finalParams = params;
        const nestedWrites = [];
        if (writeOperationsSupportingNestedWrites.includes(params.action)) {
            relations.forEach((relation) => extractNestedWriteInfo(params, relation).forEach((nestedWriteInfo) => {
                // store nextReached promise callbacks to set whether next has been
                // called or if middleware has thrown beforehand
                const nextReachedCallbacks = {
                    resolve() { },
                    reject() { },
                };
                // store result promise callbacks so we can settle it once we know how
                const resultCallbacks = {
                    resolve() { },
                    reject() { },
                };
                // wrap params updated callback in a promise so we can await it
                const nextReached = new Promise((resolve, reject) => {
                    nextReachedCallbacks.resolve = resolve;
                    nextReachedCallbacks.reject = reject;
                });
                const result = nestedMiddleware(nestedWriteInfo.params, (updatedParams) => {
                    // Update final params to include nested middleware changes.
                    // Scope updates to [argPath].[action] to avoid breaking params
                    set(finalParams.args, `${nestedWriteInfo.argPath}.${updatedParams.action}`, updatedParams.args);
                    // notify parent middleware that params have been updated
                    nextReachedCallbacks.resolve();
                    // only resolve nested next when resolveRef.resolve is called
                    return new Promise((resolve, reject) => {
                        resultCallbacks.resolve = resolve;
                        resultCallbacks.reject = reject;
                    });
                }).catch((e) => {
                    // reject nextReached promise so if it has not already resolved the
                    // parent will catch the error when awaiting it.
                    nextReachedCallbacks.reject(e);
                    // rethrow error so the parent catches it when awaiting `result`
                    throw e;
                });
                nestedWrites.push({
                    relationName: relation.name,
                    nextReached,
                    resultCallbacks,
                    result,
                });
            }));
        }
        try {
            // wait for all nested middleware to have reached next and updated params
            await Promise.all(nestedWrites.map(({ nextReached }) => nextReached));
            // evaluate result from parent middleware
            const result = await middleware(finalParams, next);
            // resolve nested middleware next functions with relevant slice of result
            await Promise.all(nestedWrites.map(async (nestedWrite) => {
                // result cannot be null because only writes can have nested writes.
                const nestedResult = get(result, nestedWrite.relationName);
                // if relationship hasn't been included nestedResult is undefined.
                nestedWrite.resultCallbacks.resolve(nestedResult);
                // set final result relation to be result of nested middleware
                set(result, nestedWrite.relationName, await nestedWrite.result);
            }));
            return result;
        }
        catch (e) {
            // When parent rejects also reject the nested next functions promises
            await Promise.all(nestedWrites.map((nestedWrite) => {
                nestedWrite.resultCallbacks.reject(e);
                return nestedWrite.result;
            }));
            throw e;
        }
    };
    return nestedMiddleware;
}
