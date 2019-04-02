import React from "react";

type ElementNames = keyof React.ReactHTML;

function buildClassName(classNames: string[]) {
    const dups: Record<string, boolean> = {};

    for (const cn of classNames) {
        dups[cn] = true;
    }

    return Object.keys(dups)
        .sort()
        .join(" ")
        .trim();
}

export function createReactBEMComponent<
    Comp extends ElementNames,
    KnownMods extends Record<string, boolean | undefined>
>(comp: Comp, blockName: string, knownMods: KnownMods) {
    type ReactProps = JSX.IntrinsicElements[Comp];

    type FinalProps = typeof knownMods extends undefined
        ? ReactProps
        : ReactProps & BoolDict<typeof knownMods>;

    const ClassNamed = React.forwardRef((props: FinalProps, ref) => {
        const {className, ...passedProps} = props as {
            className?: string;
            mods?: Record<string, unknown>;
        };

        let componentProps: Record<string, any> = {};
        const usedMods: string[] = [];

        if (knownMods) {
            for (const prop in passedProps) {
                const isActive = knownMods[prop];
                if (isActive) {
                    usedMods.push(prop);
                } else {
                    componentProps[prop] = (passedProps as any)[prop];
                }
            }
        } else {
            componentProps = passedProps;
        }

        const parentClassNames =
            typeof className === "string" ? className.split(" ") : [];

        const finalClassName = buildClassName(
            parentClassNames
                .concat(generateBEMModClassNames(blockName, usedMods))
                .concat(blockName),
        );

        return React.createElement(comp, {
            ...componentProps,
            className: finalClassName,
            ref,
        });
    });

    ClassNamed.displayName = `ClassNamed(${comp})`;

    return (ClassNamed as any) as ((props: FinalProps) => any) & {
        displayName: string;
    };
}

type BoolDict<T> = {[P in keyof T]?: boolean};

function generateBEMModClassNames(name: string, mods: string[]) {
    return mods.map(mod => {
        return name + "--" + mod;
    });
}

export function bemed(prefix?: string) {
    return function createBEMBlock<
        BEMBlock extends ElementNames = "div",
        BEMBlockMods extends Record<string, true> | undefined = undefined
    >(
        blockName: string,
        options: {el?: BEMBlock; mods?: BEMBlockMods} | undefined = {},
    ) {
        type BEMBlockProps = BoolDict<BEMBlockMods>;
        const blockClassName = (prefix || "") + blockName;

        const Block = createReactBEMComponent(
            options.el || "div",
            blockClassName,
            options.mods as BEMBlockProps,
        );

        Block.displayName = `BEMBlock(${blockClassName})`;

        return Object.assign(Block, {
            className: blockClassName,
            createBEMElement<
                BEMElement extends ElementNames,
                BEMElementMods extends
                    | Record<string, true>
                    | undefined = undefined
            >(
                blockElementName: string,
                elementOptions:
                    | {el?: BEMElement; mods?: BEMElementMods}
                    | undefined = {},
            ) {
                type BEMElementProps = BoolDict<BEMElementMods>;

                const fullElementName =
                    blockClassName + "__" + blockElementName;

                const BEMElement = createReactBEMComponent(
                    elementOptions.el || "div",
                    fullElementName,
                    elementOptions.mods as BEMElementProps,
                );

                BEMElement.displayName = `BEMElement(${fullElementName})`;

                return BEMElement;
            },
        });
    };
}