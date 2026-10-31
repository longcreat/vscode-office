import { useEffect, useState } from 'react';
import '@vscode/codicons/dist/codicon.css';
import { getConfigs } from '../../util/vscodeConfig.ts';
import { handler } from '../../util/vscode.ts';
import '../sqlite/Sqlite.less';
import './Json.less';
import JsonTree from './JsonTree.tsx';
import JsonlTable from './JsonlTable.tsx';

interface OpenPayload {
    path?: string;
    buffer?: number[];
    readOnly?: boolean;
    ext?: string;
    fileName?: string;
}

// jsonl 走主进程解析（skipOpen 不发 open 事件），模式必须在挂载时由 configs 判定
const initialIsJsonl = () => {
    const name = getConfigs()?.fileName ?? '';
    return /\.(jsonl|ndjson)$/i.test(name);
};

export default function JsonViewer() {
    const [payload, setPayload] = useState<OpenPayload | null>(null);
    const [isJsonl, setIsJsonl] = useState(initialIsJsonl);

    useEffect(() => {
        handler
            .on('open', (p: OpenPayload) => {
                setPayload(p);
                setIsJsonl(/\.(jsonl|ndjson)$/i.test(p.ext ?? p.fileName ?? ''));
            })
            .emit('init');
    }, []);

    if (isJsonl) {
        return <JsonlTable />;
    }
    return <JsonTree payload={payload} />;
}
