import subprocess
js=subprocess.check_output(['npx','esbuild','main.js','--bundle','--minify','--format=iife','--legal-comments=none']).decode()
import base64
js=js.replace('__SE_LAND__',base64.b64encode(open('se_land.mp3','rb').read()).decode())
js=js.replace('</script','<\\/script')
t=open('template.html').read()
open('../tannawa-maetobi.html','w').write(t.replace('/*BUNDLE*/',js))
