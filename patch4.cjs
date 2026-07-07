const fs = require('fs');
let lines = fs.readFileSync('components/CharacterForm.tsx', 'utf8').split('\n');

const replacement = `                           {firstMesPreview && !isEditingFirstMes ? (
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

lines.splice(1197, 9, replacement); // 1198 is index 1197. Replacing 9 lines (1198 to 1206)

fs.writeFileSync('components/CharacterForm.tsx', lines.join('\n'));
