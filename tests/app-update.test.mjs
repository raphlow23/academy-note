import test from 'node:test';
import assert from 'node:assert/strict';
import {htmlBuild,freshAppUrl,latestBuild} from '../app-update.js';
const html=(app='a',css='a')=>`<link rel="stylesheet" href="./theme.css?v=${css}"><script type="module" src="./app.js?v=${app}"></script>`;
test('화면 또는 스타일 버전이 바뀌면 새 빌드로 구분하고 유효하지 않은 페이지는 업데이트로 보지 않는다',()=>{
 assert.notEqual(htmlBuild(html()),htmlBuild(html('b')));assert.notEqual(htmlBuild(html()),htmlBuild(html('a','b')));
 assert.equal(htmlBuild('<h1>접속 오류</h1>'),'');assert.equal(htmlBuild(html()),htmlBuild(`<script src='./app.js?v=a' type='module'></script><link href='./theme.css?v=a' rel='stylesheet'>`));
});
test('앱 다시 불러오기는 기존 관리 공간 주소를 유지하며 캐시용 주소 값만 바꾼다',()=>{
 const u=new URL(freshAppUrl('https://example.test/app/?workspace=private-id&_app=old#home',123));assert.equal(u.origin,'https://example.test');assert.equal(u.pathname,'/app/');assert.equal(u.searchParams.get('workspace'),'private-id');assert.equal(u.searchParams.get('_app'),'123');assert.equal(u.hash,'#home');
});
test('업데이트 확인은 캐시를 우회하고 구글 연결 정보나 관리 공간 ID를 보내지 않는다',async()=>{
 let called;const build=await latestBuild('https://example.test/app/?workspace=private-id',async(url,options)=>{called={url,options};return {ok:true,text:async()=>html('new')};},456);
 assert.equal(build,htmlBuild(html('new')));assert.equal(called.options.cache,'no-store');assert.equal(called.options.headers,undefined);assert.equal(called.url,'https://example.test/app/index.html?_check=456');
});
test('업데이트 조회 실패는 현재 앱을 새 주소로 이동시키지 않는다',async()=>{
 await assert.rejects(latestBuild('https://example.test/app/',async()=>({ok:false})),/확인하지 못/);
});
