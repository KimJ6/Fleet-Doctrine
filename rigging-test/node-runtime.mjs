// Headless analysis uses the same pinned modules as the browser, without vendoring assets.
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const fetchText = async url => { const r = await fetch(url); if (!r.ok) throw Error(`${url}: ${r.status}`); return r.text(); };
export async function runtime() {
  globalThis.window = globalThis;
  const base = 'https://cdn.jsdelivr.net/npm/three@0.170.0/';
  const threeURL = data(await fetchText(base + 'build/three.module.js'));
  const THREE = await import(threeURL);
  const rewrite = text => text.replaceAll("from 'three'", `from '${threeURL}'`);
  const utils = data(rewrite(await fetchText(base + 'examples/jsm/curves/NURBSUtils.js')));
  const curve = data(rewrite(await fetchText(base + 'examples/jsm/curves/NURBSCurve.js')).replaceAll("'../curves/NURBSUtils.js'", `'${utils}'`));
  const zip = data(await fetchText(base + 'examples/jsm/libs/fflate.module.js'));
  const loaderURL = data(rewrite(await fetchText(base + 'examples/jsm/loaders/FBXLoader.js')).replaceAll("'../libs/fflate.module.js'", `'${zip}'`).replaceAll("'../curves/NURBSCurve.js'", `'${curve}'`));
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  const { FBXLoader } = await import(loaderURL);
  const bvhURL = data(rewrite(await fetchText('https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.1/build/index.module.js')));
  const BVH = await import(bvhURL);
  return { THREE, FBXLoader, BVH, threeURL, module: async text => import(data(rewrite(text).replaceAll("from 'three-mesh-bvh'", `from '${bvhURL}'`))) };
}
