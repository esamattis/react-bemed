import * as BabelTypes from "@babel/types";
import { basename } from "path";
import { Visitor, NodePath } from "@babel/traverse";
import { SourceMapGenerator } from "source-map";
import convert from "convert-source-map";
import Stylis from "stylis";
import { adaptStylis } from "./stylis-adapter";

declare const process: any;

interface BabelFile {
    opts: {
        generatorOpts: any;
    };
    code: string;
    path: NodePath;
}

export interface BemedBabelPluginOptions {
    target?: string;
    runtime?: string;
    stylis?: typeof stylis;
    stylisOptions?: ConstructorParameters<typeof Stylis>[0];
    precompile?: boolean;
    sourceMap?: boolean;
    assertUniqueNames?: boolean;
    generateName?: (options: {
        filename: string;
        variableName: string;
    }) => string | undefined;
}

interface VisitorState {
    opts?: BemedBabelPluginOptions;
    file: BabelFile;
    filename?: string;
}

export interface Babel {
    types: typeof BabelTypes;
}

function getGeneratorOpts(
    file: BabelFile,
): { sourceFileName: string; sourceRoot: string } {
    return file.opts.generatorOpts ? file.opts.generatorOpts : file.opts;
}

export function makeSourceMapGenerator(file: BabelFile) {
    const generatorOpts = getGeneratorOpts(file);
    const filename = generatorOpts.sourceFileName;
    const generator = new SourceMapGenerator({
        file: filename,
        sourceRoot: generatorOpts.sourceRoot,
    });

    generator.setSourceContent(filename, file.code);
    return generator;
}

export function getSourceMap(
    offset: {
        line: number;
        column: number;
    },
    file: BabelFile,
): string {
    const generator = makeSourceMapGenerator(file);
    const generatorOpts = getGeneratorOpts(file);
    if (generatorOpts.sourceFileName) {
        generator.addMapping({
            generated: {
                line: 1,
                column: 0,
            },
            source: generatorOpts.sourceFileName,
            original: offset,
        });
        return convert.fromObject(generator).toComment({ multiline: true });
    }
    return "";
}

function createArrayExpression(
    t: typeof BabelTypes,
    strings: string[],
    expressions: BabelTypes.Expression[],
    // out: BabelTypes.Expression[],
): BabelTypes.ArrayExpression {
    return t.arrayExpression(
        strings.map((s) => {
            const match = /__BEMED_VAR_([0-9]+)__/.exec(s);
            if (match?.[1]) {
                const index = Number(match[1]);
                return expressions[index];
            }

            return t.stringLiteral(s);
        }),
    );
}

export const SEEN_NAMES = new Map<
    string,
    { file: string; varName: string; line: number }
>();

export const SEEN_FILES = new Set<string>();

function assertUniqueNames(opts: {
    name: string;
    file: string | undefined;
    path: NodePath<BabelTypes.CallExpression>;
}) {
    if (process.env.NODE_ENV !== "production") {
        return;
    }

    if (process.env.BEMED_DISABLE_DUPLICATE_DETECTION) {
        return;
    }

    if (!opts.file) {
        return;
    }

    // Do not check files twice since for example Next.js compiles each file
    // twice, once for the client and once for the server
    if (SEEN_FILES.has(opts.file)) {
        return;
    }

    const dup = SEEN_NAMES.get(opts.name);

    if (!dup) {
        SEEN_NAMES.set(opts.name, {
            file: opts.file,
            varName: opts.name,
            line: opts.path.node.loc?.start.line ?? 0,
        });
        return;
    }

    throw opts.path.buildCodeFrameError(
        `bemed component name "${opts.name}" already defined in ${dup.file} line ${dup.line}`,
    );
}

const CSS_CACHE = new Map<string, string[] | undefined>();

export default function bemedBabelPlugin(
    babel: Babel,
): { visitor: Visitor<VisitorState> } {
    const t = babel.types;

    /**
     * Local name of the css import from react-bemed/css if any
     */
    let cssImportName: string | null = null;
    let bemedImportName: string | null = null;

    let adaptedStylis: ReturnType<typeof adaptStylis> | null = null;

    return {
        visitor: {
            Program: {
                enter(path, state) {
                    if (!state.opts) {
                        state.opts = {};
                    }

                    const opts = state.opts;

                    // Default to true
                    if (opts.precompile !== false) {
                        opts.precompile = true;
                    }

                    // Reset import name state when entering a new file
                    cssImportName = null;
                    bemedImportName = null;
                },
                exit(path, state) {
                    if (state.filename) {
                        SEEN_FILES.add(state.filename);
                    }
                },
            },

            ImportDeclaration(path, state) {
                const opts = state.opts || {};

                const target = opts.target || "react-bemed/css";

                if (path.node.source.value === "react-bemed/css") {
                    for (const s of path.node.specifiers) {
                        if (!t.isImportSpecifier(s)) {
                            continue;
                        }

                        if (s.imported.name === "css") {
                            cssImportName = s.local.name;
                        }
                    }

                    if (opts.precompile) {
                        path.node.source.value = "react-bemed/css-precompiled";
                    }
                }

                if (path.node.source.value === "react-bemed") {
                    for (const s of path.node.specifiers) {
                        if (!t.isImportSpecifier(s)) {
                            continue;
                        }

                        if (s.imported.name === "bemed") {
                            bemedImportName = s.local.name;
                        }
                    }
                }
            },

            CallExpression(path, state) {
                if (bemedImportName === null) {
                    return;
                }

                if (!state.filename) {
                    return;
                }

                if (path.node.callee.type !== "Identifier") {
                    return;
                }

                if (path.node.callee.name !== bemedImportName) {
                    return;
                }

                if (path.parentPath.node.type !== "VariableDeclarator") {
                    return;
                }

                if (path.parentPath.node.id.type !== "Identifier") {
                    return;
                }

                let existingName: string | null = null;

                const currentArg = path.node.arguments[0];

                if (currentArg?.type === "ObjectExpression") {
                    const props = currentArg.properties.map((prop) => {
                        if (prop.type !== "ObjectProperty") {
                            return;
                        }

                        if (!t.isIdentifier(prop.key)) {
                            return;
                        }

                        if (prop.value.type !== "StringLiteral") {
                            return;
                        }

                        return {
                            propName: prop.key.name,
                            value: prop.value.value,
                        };
                    });

                    const existing = props.find(
                        (prop) => prop?.propName === "name",
                    );

                    if (existing) {
                        existingName = existing.value;
                    }
                }

                if (existingName) {
                    assertUniqueNames({
                        name: existingName,
                        path,
                        file: state.filename,
                    });
                    return;
                }

                const variableName = path.parentPath.node.id.name;

                let name = variableName;

                if (state.opts?.generateName) {
                    const generatedName = state.opts.generateName({
                        variableName,
                        filename: state.filename,
                    });
                    if (generatedName) {
                        name = generatedName;
                    }
                }

                const nameProp = t.objectProperty(
                    t.identifier("name"),
                    t.stringLiteral(name),
                );

                if (!currentArg) {
                    assertUniqueNames({ name, path, file: state.filename });
                    path.node.arguments[0] = t.objectExpression([nameProp]);
                    return;
                }

                if (currentArg.type === "ObjectExpression") {
                    assertUniqueNames({ name, path, file: state.filename });
                    currentArg.properties.unshift(nameProp);
                }
            },

            TaggedTemplateExpression(path, state) {
                if (!cssImportName) {
                    return;
                }

                if (!t.isIdentifier(path.node.tag, { name: cssImportName })) {
                    return;
                }

                if (!path.node.loc) {
                    return;
                }

                const opts = state.opts || {};

                const addSourceMap =
                    typeof opts.sourceMap === "boolean"
                        ? opts.sourceMap
                        : process.env.NODE_ENV !== "production";

                const sourceMap = addSourceMap
                    ? getSourceMap(path.node.loc.start, state.file)
                    : "";

                // Interleave template string parts with variable index placeholders
                // Ex.
                //      `color: ${colorVar};`
                // to
                //      [ "color:", "__BEMED_VAR_0__", ";" ]
                //
                let cssArray = path.node.quasi.quasis
                    .map((q) => {
                        return q.value.raw as string;
                    })
                    .flatMap((value, index, array) => {
                        if (array.length - 1 !== index) {
                            return [value, `__BEMED_VAR_${index}__`];
                        }

                        return value;
                    });

                if (opts.precompile) {
                    if (!adaptedStylis) {
                        const finalStylis =
                            opts?.stylis ??
                            new Stylis({
                                prefix: process.env.NODE_ENV === "production",
                                ...opts?.stylisOptions,
                            });
                        adaptedStylis = adaptStylis(finalStylis);
                    }

                    const styleString = cssArray.join("");

                    const cached = CSS_CACHE.get(styleString);
                    if (cached) {
                        cssArray = cached;
                    } else {
                        const newCSS = adaptedStylis("__BEMED__", styleString);
                        cssArray = newCSS.split(/(__BEMED_VAR_[0-9]+__)/);
                        CSS_CACHE.set(styleString, cssArray);
                    }
                }

                // Put template expressions to the placeholders in the array
                //
                //      [ "color:", "__BEMED_VAR_0__", ";" ]
                //  to
                //      [ "color:", colorVar, ";" ]
                //
                const array = t.arrayExpression(
                    cssArray.map((s) => {
                        const match = /^__BEMED_VAR_([0-9]+)__$/.exec(s);
                        if (match?.[1]) {
                            const index = Number(match[1]);
                            return path.node.quasi.expressions[index];
                        }

                        return t.stringLiteral(s);
                    }),
                );

                // [..., ...].join("")
                const arrayJoin = t.callExpression(
                    t.memberExpression(array, t.identifier("join")),
                    [t.stringLiteral("")],
                );

                const sourceMapStringLiteral = t.stringLiteral(sourceMap);

                path.replaceWith(
                    t.callExpression(t.identifier(cssImportName), [
                        arrayJoin,
                        sourceMapStringLiteral,
                    ]),
                );
            },
        },
    };
}
