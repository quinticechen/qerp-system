import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'

// index.html carries the Home page's meta tags for crawlers that don't run JavaScript.
// Drop them so each page's SEO component (react-helmet-async) is the only source.
document.head.querySelectorAll('[data-default-seo]').forEach((element) => element.remove());

createRoot(document.getElementById("root")!).render(<App />);
