const fs = require('fs');
let code = fs.readFileSync('components/CharacterForm.tsx', 'utf8');

// Insert functions before interface CharacterFormProps
const funcs = `
const stripHidden = (t: string) => {
    const HIDE_PATTERNS = [
      /\\{\\{reasoning\\}\\}[\\s\\S]*?\\{\\{\\/reasoning\\}\\}/gi,
      /<\\|[\\s\\S]*?\\|>/g,
      /<!(?!--)[^>]*>/g,
      /<think>[\\s\\S]*?<\\/think>/gi,
    ];
    let res = t;
    for (const p of HIDE_PATTERNS) res = res.replace(p, '');
    return res;
};

const applyRegex = (text: string, scripts: any[], place: number = 2) => {
    let r = text;
    for (const s of scripts) {
      if (s.disabled || s.promptOnly) continue;
      if (s.placement && s.placement.length && !s.placement.includes(place)) continue;
      try {
        const m = s.find.match(/^\\/(.*)\\/([gimsuy]*)$/s);
        let re;
        if (m) {
          re = new RegExp(m[1], m[2] || 'g');
        } else {
          re = new RegExp(s.find, 'g');
        }
        r = r.replace(re, s.replace || '');
      } catch (e) {
        // ignore
      }
    }
    return r;
};

const renderHtmlMessage = (raw: string, char: Partial<Character>) => {
    if (!raw) return { __html: '' };
    let scripts: any[] = [];
    if (char.extensions && char.extensions.regex_scripts) {
      scripts = char.extensions.regex_scripts;
    } else if (char.originalData && char.originalData.extensions && char.originalData.extensions.regex_scripts) {
      scripts = char.originalData.extensions.regex_scripts;
    } else if (char.originalData && char.originalData.data && char.originalData.data.extensions && char.originalData.data.extensions.regex_scripts) {
      scripts = char.originalData.data.extensions.regex_scripts;
    }
    
    const parsedScripts = scripts.map((s: any, i: number) => ({
      id: i,
      find: s.findRegex || s.find || '',
      replace: s.replaceString != null ? s.replaceString : (s.replace || ''),
      disabled: !!s.disabled,
      promptOnly: !!s.promptOnly,
      placement: Array.isArray(s.placement) ? s.placement : [2],
    })).filter((s: any) => s.find);

    let text = stripHidden(raw);
    text = applyRegex(text, parsedScripts, 2);
    text = text.trim();
    if (!text) return { __html: '' };
    text = text.replace(/^\`\`\`(?:html)?\\s*/i, '').replace(/\\s*\`\`\`\\s*$/, '').trim();
    
    if (/<[a-zA-Z][^>]*>/.test(text)) {
      return { __html: text };
    }
    
    let t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    t = t.replace(/\\*\\*([^\\*]+?)\\*\\*/g, '<strong style="font-weight:700">$1</strong>');
    t = t.replace(/\\*([^\\*]+?)\\*/g, '<em style="font-style:italic">$1</em>');
    
    const paras = t.split(/\\n{2,}/);
    if (paras.length > 1) {
      t = paras.map((p: string) => '<p style="margin:0 0 1em 0">' + p.replace(/\\n/g, '<br>') + '</p>').join('');
    } else {
      t = t.replace(/\\n/g, '<br>');
    }
    return { __html: t };
};
`;

code = code.replace('interface CharacterFormProps {', funcs + '\ninterface CharacterFormProps {');

// Add the toggle button
const targetBtnStr = `                               </>
                           ) : (
                               <>
                                   <button
                                        onClick={() => {
                                           setTempFirstMes(getCurrentMessage());
                                           setIsEditingFirstMes(true);
                                       }}`;
                                       
const toggleBtnStr = `                               </>
                           ) : (
                               <>
                                   <button 
                                       onClick={() => setFirstMesPreview(!firstMesPreview)}
                                       className={\`text-xs px-2 py-1 rounded border transition-colors \${theme === 'light' ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600' : 'bg-slate-800 border-white/10 hover:bg-slate-700 text-gray-300'}\`}
                                   >
                                       {firstMesPreview ? '源码 (Raw)' : '渲染预览 (Rendered)'}
                                   </button>
                                   <div className={\`h-4 w-px mx-1 \${theme === 'light' ? 'bg-slate-300' : 'bg-white/20'}\`}></div>
                                   <button
                                        onClick={() => {
                                           setFirstMesPreview(false);
                                           setTempFirstMes(getCurrentMessage());
                                           setIsEditingFirstMes(true);
                                       }}`;
                                       
code = code.replace(targetBtnStr, toggleBtnStr);

// Render logic
const targetRender = `                           <textarea
                                readOnly={!isEditingFirstMes}
                               value={isEditingFirstMes ? tempFirstMes : getCurrentMessage()}
                               onChange={(e) => isEditingFirstMes && setTempFirstMes(e.target.value)}
                               className={\`flex-1 w-full resize-none p-8 text-sm leading-7 outline-none font-mono custom-scrollbar bg-transparent
                                    \${theme === 'light' ? 'text-slate-700 placeholder-slate-400 selection:bg-rose-100' : 'text-gray-200 placeholder-gray-600 selection:bg-rose-500/30'}
                                    \${!isEditingFirstMes ? 'cursor-default' : ''}\`}
                               placeholder="暂无内容..."
                           />`;
                           
const replaceRender = `                           {firstMesPreview ? (
                               <div className={\`flex-1 w-full p-8 text-sm leading-7 custom-scrollbar overflow-y-auto markdown-body \${theme === 'light' ? 'text-slate-700' : 'text-gray-200'}\`} 
                                    dangerouslySetInnerHTML={renderHtmlMessage(getCurrentMessage(), formData)} />
                           ) : (
                               <textarea
                                   readOnly={!isEditingFirstMes}
                                   value={isEditingFirstMes ? tempFirstMes : getCurrentMessage()}
                                   onChange={(e) => isEditingFirstMes && setTempFirstMes(e.target.value)}
                                   className={\`flex-1 w-full resize-none p-8 text-sm leading-7 outline-none font-mono custom-scrollbar bg-transparent
                                        \${theme === 'light' ? 'text-slate-700 placeholder-slate-400 selection:bg-rose-100' : 'text-gray-200 placeholder-gray-600 selection:bg-rose-500/30'}
                                        \${!isEditingFirstMes ? 'cursor-default' : ''}\`}
                                   placeholder="暂无内容..."
                               />
                           )}`;

code = code.replace(targetRender, replaceRender);

fs.writeFileSync('components/CharacterForm.tsx', code);
