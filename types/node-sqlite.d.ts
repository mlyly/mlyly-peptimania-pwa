/**
 * Minimal typings for the built-in `node:sqlite` module.
 *
 * The project pins `@types/node@20`, which predates `node:sqlite` (shipped in
 * Node 22.5+ and stable in Node 24/26). We only use the synchronous database
 * API, so this declaration covers exactly that surface.
 */
declare module "node:sqlite" {
    export type SQLInputValue = null | number | bigint | string | Uint8Array;
    export type SQLOutputValue = null | number | bigint | string | Uint8Array;

    export interface StatementResultingChanges {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
    }

    export interface StatementSync {
        run(...params: SQLInputValue[]): StatementResultingChanges;

        get(...params: SQLInputValue[]): Record<string, SQLOutputValue> | undefined;

        all(...params: SQLInputValue[]): Record<string, SQLOutputValue>[];

        iterate(...params: SQLInputValue[]): IterableIterator<Record<string, SQLOutputValue>>;

        setAllowBareNamedParameters(enabled: boolean): void;

        setReadBigInts(enabled: boolean): void;
    }

    export interface DatabaseSyncOptions {
        open?: boolean;
        readOnly?: boolean;
        enableForeignKeyConstraints?: boolean;
        enableDoubleQuotedStringLiterals?: boolean;
        allowExtension?: boolean;
        timeout?: number;
    }

    export class DatabaseSync {
        constructor(path: string, options?: DatabaseSyncOptions);

        open(): void;

        close(): void;

        exec(sql: string): void;

        prepare(sql: string): StatementSync;

        createFunction(
            name: string,
            options: { deterministic?: boolean } | undefined,
            fn: (...args: SQLOutputValue[]) => SQLOutputValue
        ): void;

        isOpen: boolean;
    }
}
