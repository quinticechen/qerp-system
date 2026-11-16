import React from 'react';
import { useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { DEFAULT_OG_IMAGE, SITE_NAME, canonicalUrl } from '@/lib/siteMeta';

interface SEOProps {
  /** Page name; shown as "<title> | QERP" unless `fullTitle` is given. */
  title: string;
  description: string;
  keywords?: string;
  /** Replaces the whole <title>, e.g. on the Home page. */
  fullTitle?: string;
  /** Path to canonicalize to; defaults to the current path. */
  canonicalPath?: string;
  ogImage?: string;
  ogType?: string;
  /** Keep the page out of search results (signed-in app pages). */
  noindex?: boolean;
  /** Structured data objects, each rendered as an application/ld+json script. */
  jsonLd?: Record<string, unknown>[];
}

export const SEO: React.FC<SEOProps> = ({
  title,
  description,
  keywords = '紡織業, 紡織 ERP, 布料管理, 訂單管理, 庫存管理, 採購管理, 出貨管理, AI 助理',
  fullTitle,
  canonicalPath,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = 'website',
  noindex = false,
  jsonLd = [],
}) => {
  const { pathname } = useLocation();
  const pageTitle = fullTitle ?? `${title} | ${SITE_NAME}`;
  const url = canonicalUrl(canonicalPath ?? pathname);

  return (
    <Helmet>
      <html lang="zh-TW" />
      <title>{pageTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />
      <link rel="canonical" href={url} />
      <link rel="alternate" hrefLang="zh-TW" href={url} />
      <link rel="alternate" hrefLang="x-default" href={url} />

      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="zh_TW" />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {jsonLd.map((data, index) => (
        <script key={index} type="application/ld+json">{JSON.stringify(data)}</script>
      ))}
    </Helmet>
  );
};
