const fs = require('fs');

function processFile(filePath) {
    let code = fs.readFileSync(filePath, 'utf8');

    // 1. Update renderHtmlMessage signature to include theme
    code = code.replace(
        /const renderHtmlMessage = \(raw: string, char: ([^)]+)\) => \{/,
        "const renderHtmlMessage = (raw: string, char: $1, theme: string = 'dark') => {"
    );

    // 2. Update the italic replacement to use opacity/muted color and support multiline
    code = code.replace(
        /t = t\.replace\(\/\\\\\\*\(\[\^\\\\\\*\]\+\?\)\\\\\\\*\/\g, '<em style="font-style:italic">\$1<\/em>'\);/g,
        `t = t.replace(/\\*([\\s\\S]+?)\\*/g, \`<em style="font-style:italic; color: \${theme === 'light' ? '#475569' : '#94a3b8'}">\$1</em>\`);`
    );

    // 3. Remove whitespace-pre-wrap from the rendering divs
    code = code.replace(
        /className=\{\`flex-1 w-full p-8 text-sm leading-7 custom-scrollbar overflow-y-auto markdown-body whitespace-pre-wrap/g,
        "className={`flex-1 w-full p-8 text-sm leading-7 custom-scrollbar overflow-y-auto markdown-body"
    );
    
    code = code.replace(
        /className="text-sm leading-relaxed opacity-90 overflow-x-hidden markdown-body whitespace-pre-wrap"/g,
        'className="text-sm leading-relaxed opacity-90 overflow-x-hidden markdown-body"'
    );

    // 4. Update the calls to renderHtmlMessage to pass the theme
    code = code.replace(
        /renderHtmlMessage\(getCurrentMessage\(\), formData\)/g,
        "renderHtmlMessage(getCurrentMessage(), formData, theme)"
    );
    
    code = code.replace(
        /renderHtmlMessage\(viewCharacter\.firstMessage, viewCharacter\)/g,
        "renderHtmlMessage(viewCharacter.firstMessage, viewCharacter, theme)"
    );

    fs.writeFileSync(filePath, code);
}

processFile('components/CharacterForm.tsx');
processFile('components/CharacterList.tsx');
