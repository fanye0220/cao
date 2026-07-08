const fs = require('fs');
let code = fs.readFileSync('components/CharacterForm.tsx', 'utf8');

// Fix renderHtmlMessage regex
code = code.replace(/text\.replace\(\/\^\\\`\\\`\\\`\(\?:html\)\?\\\\s\*\/\i, ''\)\.replace\(\/\\\\s\*\\\`\\\`\\\`\\\\s\*\$\/, ''\)\.trim\(\)/g, "text.replace(/```(?:html)?/gi, '').trim()");

// Add whitespace-pre-wrap to the rendered div
code = code.replace(
    /className=\{\`flex-1 w-full p-8 text-sm leading-7 custom-scrollbar overflow-y-auto markdown-body/,
    "className={`flex-1 w-full p-8 text-sm leading-7 custom-scrollbar overflow-y-auto markdown-body whitespace-pre-wrap"
);

fs.writeFileSync('components/CharacterForm.tsx', code);
