declare module 'sql.js' {
    export interface QueryResults {
        columns: string[];
        values: unknown[][];
    }

    export interface Database {
        exec(sql: string): QueryResults[];
        run(sql: string, params?: unknown[]): void;
        getRowsModified(): number;
        close(): void;
        export(): Uint8Array;
    }

    export interface SqlJsStatic {
        Database: new (data?: ArrayLike<number> | Uint8Array | null) => Database;
    }

    export interface SqlJsConfig {
        locateFile?: (file: string) => string;
    }

    export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
