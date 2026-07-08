const fs = require('fs');

function processFile(filePath) {
    let code = fs.readFileSync(filePath, 'utf8');

    code = code.replace(
        "t = t.replace(/\\*([^\\*]+?)\\*/g, '<em style=\"font-style:italic\">$1</em>');",
        "t = t.replace(/\\*([\\s\\S]+?)\\*/g, `<em style=\"font-style:italic; color: ${theme === 'light' ? '#64748b' : '#94a3b8'}\">$1</em>`);"
    );

    fs.writeFileSync(filePath, code);
}

processFile('components/CharacterForm.tsx');
processFile('components/CharacterList.tsx');
