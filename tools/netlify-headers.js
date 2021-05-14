'use strict';

const [root] = process.argv.slice(2);

const AssetGraph = require('assetgraph-builder');

const headers = ['Content-Security-Policy'];

const resourceHintTypeMap = {
  HtmlPreloadLink: 'preload',
  HtmlPrefetchLink: 'prefetch',
  HtmlPreconnectLink: 'preconnect',
  HtmlDnsPrefetchLink: 'dns-prefetch'
};

function getHeaderForRelation(rel) {
  let header = `Link: <${rel.href}>; rel=${resourceHintTypeMap[rel.type]}; as=${rel.as}; type=${rel.to.contentType}`;

  if (rel.as === 'font') {
    header = `${header}; crossorigin=anonymous`;
  }

  return header;
}

console.error('Generating optimal netlify headers...');

(async function() {
  const graph = new AssetGraph({ root });

  await graph.loadAssets('*.html');

  await graph.populate({
    followRelations: { type: { $or: ['HtmlAnchor', 'FileRedirect'] }, crossorigin: false }
  });

  const assets = graph.findAssets({
    type: 'Html',
    isInline: false,
    isLoaded: true
  });

  const headerMap = {};
  const garbageNodes = new Set();
  const garbageRelations = new Set();

  for (const asset of assets) {
    const url =
      '/' +
      asset.url
        .replace(graph.root, '')
        .replace(/#.*/, '')
        .replace('index.html', '');
    if (!headerMap[url]) {
      headerMap[url] = [];
    }

    headers.forEach(function(header) {
      const node = asset.parseTree.querySelector('meta[http-equiv=' + header + ']');

      if (node) {
        headerMap[url].push(`${header}: ${node.getAttribute('content')}`);
        garbageNodes.add(node);
        asset.markDirty();
      }
    });

    const firstCssRel = asset.outgoingRelations.filter(r => {
      return r.type === 'HtmlStyle' && r.crossorigin === false && r.href !== undefined;
    })[0];

    if (firstCssRel) {
      const header = `Link: <${firstCssRel.href}>; rel=preload; as=style`;

      headerMap[url].push(header);
    }

    const resourceHintRelations = asset.outgoingRelations.filter(r =>
      ['HtmlPreloadLink', 'HtmlPrefetchLink'].includes(r.type)
    );

    resourceHintRelations.forEach(rel => {
      headerMap[url].push(getHeaderForRelation(rel));
      garbageRelations.add(rel);
    });

    const preconnectRelations = asset.outgoingRelations.filter(r => ['HtmlPreconnectLink'].includes(r.type));

    preconnectRelations.forEach(rel => {
      let header = `Link: <${rel.href}>; rel=preconnect`;

      headerMap[url].push(header);
      garbageRelations.add(rel);
    });
  }

  for (const node of garbageNodes) {
    node.parentNode.removeChild(node);
    asset.markDirty();
  }

  for (const relation of garbageRelations) {
    relation.detach();
  }

  await graph.writeAssetsToDisc({ isLoaded: true });

  console.log('\n## Autogenerated headers:\n');

  Object.keys(headerMap).forEach(function(url) {
    console.log(url);

    const httpHeaders = headerMap[url];

    httpHeaders.forEach(function(header) {
      console.log(`  ${header}`);
    });

    console.log('');
  });

  console.error('netlify headers done!');
})();
