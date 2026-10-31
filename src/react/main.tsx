import './polyfills/buffer';
import ReactDOM from 'react-dom/client';
import './util/vscode.js';
import { getConfigs } from './util/vscodeConfig.ts';
import { initI18n, $t } from './i18n/i18nConfig.ts';
import './main.css'
import { ConfigProvider } from 'antd';
import { lazy, Suspense, Component, type ReactNode } from 'react';
import { antThemeConfig } from './antThemeConfig.ts';
import GitHistory from './view/gitHistory/GitHistory.tsx';
const Zip = lazy(() => import('./view/compress/Zip.tsx'))
const Excel = lazy(() => import('./view/excel/Excel.tsx'))
const Image = lazy(() => import('./view/image/Image.tsx'))
const SvgViewer = lazy(() => import('./view/svg/SvgViewer.tsx'))
const Word = lazy(() => import('./view/word/Word.tsx'))
const PowerPoint = lazy(() => import('./view/powerpoint/PowerPoint.tsx'))
const FontViewer = lazy(() => import('./view/fontViewer/FontViewer.tsx'))
const Epub = lazy(() => import('./view/epub/Epub.tsx'))
const IcnsViewer = lazy(() => import('./view/icns/IcnsViewer.tsx'))
const PsdViewer = lazy(() => import('./view/psd/PsdViewer.tsx'))
const XmindViewer = lazy(() => import('./view/xmind/XmindViewer.tsx'))
const Parquet = lazy(() => import('./view/parquet/Parquet.tsx'))
const Sqlite = lazy(() => import('./view/sqlite/Sqlite.tsx'))
const WebUnsupported = lazy(() => import('./view/WebUnsupported.tsx'))

document.getElementById('_defaultStyles')?.parentNode?.removeChild(document.getElementById('_defaultStyles'))
const configs = getConfigs();
initI18n(configs?.language);

/** 渲染崩溃兜底：显示错误信息而非整页空白，便于定位 */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', color: '#f48771', whiteSpace: 'pre-wrap' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Render error:</div>
          {String(this.state.error?.message || this.state.error)}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const route = configs?.route
  const content = (() => {
    switch (route) {
    case 'image':
      return <Image />
    case 'svg':
      return <SvgViewer />
    case 'excel':
      return <Excel />
    case 'zip':
      return <Zip />
    case 'word':
      return <Word />
    case 'ppt':
      return <PowerPoint />
    case 'font':
      return <FontViewer />
    case 'epub':
      return <Epub />
    case 'icns':
      return <IcnsViewer />
    case 'psd':
      return <PsdViewer />
    case 'xmind':
      return <XmindViewer />
    case 'parquet':
      return <Parquet />
    case 'gitHistory':
      return <GitHistory />
    case 'webUnsupported':
      return <WebUnsupported />
    case 'sqlite':
      return <Sqlite />
    default:
      return <>{$t('common.officeViewer')}</>
  }
})()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider
    componentSize='small'
    theme={antThemeConfig}
  >
    <App />
  </ConfigProvider>
)
