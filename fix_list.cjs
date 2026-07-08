const fs = require('fs');
let code = fs.readFileSync('components/CharacterList.tsx', 'utf8');

code = code.replace(
    /className="text-sm leading-relaxed opacity-90 overflow-x-hidden markdown-body"/g,
    'className="text-sm leading-relaxed opacity-90 overflow-x-hidden markdown-body whitespace-pre-wrap"'
);

fs.writeFileSync('components/CharacterList.tsx', code);
