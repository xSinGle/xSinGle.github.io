/* global hexo */

'use strict';

const { parse } = require('url');

/**
 * Export theme config to js
 */
hexo.extend.helper.register('next_config', function() {
  const { config, theme, next_version } = this;
  config.algolia = config.algolia || {};
  const exportConfig = {
    hostname  : parse(config.url).hostname || config.url,
    root      : config.root,
    scheme    : theme.scheme,
    version   : next_version,
    exturl    : theme.exturl,
    sidebar   : theme.sidebar,
    copycode  : theme.codeblock.copy_button.enable,
    bookmark  : theme.bookmark,
    fancybox  : theme.fancybox,
    mediumzoom: theme.mediumzoom,
    lazyload  : theme.lazyload,
    pangu     : theme.pangu,
    comments  : theme.comments,
    algolia   : {
      appID    : config.algolia.applicationID,
      apiKey   : config.algolia.apiKey,
      indexName: config.algolia.indexName,
      hits     : theme.algolia_search.hits,
      labels   : theme.algolia_search.labels
    },
    localsearch: theme.local_search,
    motion     : theme.motion,
    prism      : config.prismjs.enable && !config.prismjs.preprocess
  };
  if (config.search) {
    exportConfig.path = config.search.path;
  }
  return `<script class="hexo-configurations">
    var NexT = window.NexT || {};
    var CONFIG = ${JSON.stringify(exportConfig)};
  </script>`;
});
