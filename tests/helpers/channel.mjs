import {readFileSync} from 'node:fs';
export const next=process.env.BILI_RANGE_CHANNEL==='next';
export const directory=next?'dist/preview':'dist/candidate';
export const namespace=next?'aijc123.BiliRange.preview.v1':'aijc123.BiliRange.adaptive.v1';
export const plugin=next?'BiliBili.Range.Preview.plugin':'BiliBili.Range.Adaptive.plugin';
export const version=JSON.parse(readFileSync(next?'src/loon/next.json':'src/loon/adaptive.json','utf8')).version;
export const artifact=name=>readFileSync(directory+'/'+name,'utf8');
