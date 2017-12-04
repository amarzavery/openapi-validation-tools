const path = require('path');
const fs = require('fs');
const markdownItMermaidPro = require("markdown-it-mermaid-pro")
const mermaid2html = markdownItMermaidPro.mermaid2html;
const mmd = fs.readFileSync('input.mmd', { encoding: 'utf8' });
const taskList = `
\`\`\`mermaid
${mmd}
\`\`\`
`;
(async (md) => {
  const defaultRootWebPath = path.join(__dirname);
  console.log('defaultRootWebPath= ', defaultRootWebPath);
  const options = {
    rootWebPath: defaultRootWebPath,
  };
  const html = await mermaid2html(md, options);
  console.log("rendered html is\n:", html);
  fs.writeFileSync('ot.html', html, { encoding: 'utf8' });
})(taskList)