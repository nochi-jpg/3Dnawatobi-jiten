import subprocess
js=subprocess.check_output(['npx','esbuild','main.js','--bundle','--minify','--format=iife','--legal-comments=none']).decode()
js=js.replace('</script','<\\/script')
t=open('template.html').read()
open('../tannawa-maetobi.html','w').write(t.replace('/*BUNDLE*/',js))
