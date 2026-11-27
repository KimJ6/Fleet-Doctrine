@echo off
chcp 65001 >nul
setlocal
title Fleet Doctrine
if not exist "%~dp0..\ship assets\rigged\Light_cruiser_01_rigged.fbx" (
  echo 함선 모델을 찾을 수 없습니다. README.md의 폴더 구성을 확인하세요.
  pause
  exit /b 1
)
pushd "%~dp0.."
if errorlevel 1 (
  echo 프로젝트 상위 폴더를 열 수 없습니다.
  pause
  exit /b 1
)
echo Fleet Doctrine 서버를 시작합니다. 게임 중 이 창을 열어 두세요.
echo 이 창을 닫거나 Ctrl+C를 누르면 서버가 종료됩니다.
echo 브라우저가 열리지 않으면 http://127.0.0.1:8001/Fleet%%20Doctrine/web/ 을 확인하세요.
where node >nul 2>&1
if not errorlevel 1 goto use_node
where uv >nul 2>&1
if errorlevel 1 (
  echo Node.js 또는 uv를 찾을 수 없습니다. README.md의 실행 안내를 확인하세요.
  popd
  pause
  exit /b 1
)
uv run --no-project --python 3.12 python -c "import http.server,threading,webbrowser; server=http.server.ThreadingHTTPServer(('127.0.0.1',8001),http.server.SimpleHTTPRequestHandler); threading.Timer(0.3,webbrowser.open,args=('http://127.0.0.1:8001/Fleet%%20Doctrine/web/',)).start(); server.serve_forever()"
goto finished
:use_node
node -e "const http=require('http'),fs=require('fs'),path=require('path'),cp=require('child_process'),root=process.cwd(),url='http://127.0.0.1:8001/Fleet%%20Doctrine/web/',types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.csv':'text/csv; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};const server=http.createServer((req,res)=>{let file;try{file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,url).pathname));if(file!==root&&!file.toLowerCase().startsWith((root+path.sep).toLowerCase()))throw Error();}catch(e){res.writeHead(400).end();return;}fs.stat(file,(err,stat)=>{if(err){res.writeHead(404).end();return;}if(stat.isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',types[path.extname(file).toLowerCase()]||'application/octet-stream');const stream=fs.createReadStream(file);stream.on('error',()=>{if(!res.headersSent)res.writeHead(404);res.end();});stream.pipe(res);});});server.on('error',err=>{console.error('서버 시작 실패: '+err.message);process.exitCode=1;});server.listen(8001,'127.0.0.1',()=>{console.log('서버 실행 중: '+url);const child=cp.spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'});child.on('error',()=>console.log('브라우저를 자동으로 열지 못했습니다. 위 주소를 열어 주세요.'));child.unref();});"
:finished
if errorlevel 1 (
  echo 서버를 시작하지 못했습니다. 8001 포트 사용 여부를 확인하세요.
  pause
)
popd
endlocal
