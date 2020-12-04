/**
 * Transform from react-bemed 0.7 to 1.0
 * usage: jscodeshift -t v1.0-upgrade.ts --parser=tsx --extensions=ts,tsx pathtodir
 */
import { ASTNode, Transform } from "jscodeshift";

const transform: Transform = (file, api, options) => {
    const j = api.jscodeshift;

    const root = j(file.source);

    root.find(j.CallExpression).forEach((path) => {
        if (path.node.callee.type !== "Identifier") {
            return;
        }

        // Must be like bemed()
        if (path.node.callee.name !== "bemed") {
            return;
        }

        const node: ASTNode = path.parentPath.node;

        // Must be like bemed()()
        if (node.type !== "CallExpression") {
            return;
        }

        const arg: ASTNode = node.arguments[0];

        // Must be like bemed()("Block")
        if (arg?.type !== "StringLiteral") {
            return;
        }

        // Create `name: "Block"` prop from  `bemed()("Block")`
        const nameProperty = j.objectProperty(
            j.identifier("name"),
            j.stringLiteral(arg.value),
        );

        const bemedArg = path.node.arguments[0];

        if (!bemedArg) {
            // Handle bemed()("Block");
            // by replacing with bemed({name: "Block"})
            j(path.parentPath).replaceWith(
                j.callExpression(j.identifier("bemed"), [
                    j.objectExpression([nameProperty]),
                ]),
            );
            return;
        }

        if (bemedArg?.type !== "ObjectExpression") {
            return;
        }

        // Handle bemed({})("Block");
        // by adding name prop
        bemedArg.properties.unshift(nameProperty);

        // and replace with bemed({name: "Block", ...existing})
        j(path.parentPath).replaceWith(
            j.callExpression(j.identifier("bemed"), [bemedArg]),
        );
    });

    return root.toSource();
};

export default transform;