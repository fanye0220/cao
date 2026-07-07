const fs = require('fs');
let code = fs.readFileSync('components/CharacterForm.tsx', 'utf8');

// The block to replace
const originalButtons = `                               </>
                           ) : (
                               <>
                                   <button
                                        onClick={() => {
                                           setTempFirstMes(getCurrentMessage());
                                           setIsEditingFirstMes(true);
                                       }}`;

const newButtons = `                               </>
                           ) : (
                               <>
                                   <button 
                                       onClick={() => setFirstMesPreview(!firstMesPreview)}
                                       className={\`text-xs px-3 py-1.5 rounded-lg border transition-colors \${theme === 'light' ? 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600' : 'bg-slate-800 border-white/10 hover:bg-slate-700 text-gray-300'}\`}
                                   >
                                       {firstMesPreview ? '源码 (Raw)' : '渲染预览 (Rendered)'}
                                   </button>
                                   <div className={\`h-4 w-px mx-2 \${theme === 'light' ? 'bg-slate-300' : 'bg-white/20'}\`}></div>
                                   <button
                                        onClick={() => {
                                           setFirstMesPreview(false);
                                           setTempFirstMes(getCurrentMessage());
                                           setIsEditingFirstMes(true);
                                       }}`;
code = code.replace(originalButtons, newButtons);

const originalRender = `                           <textarea
                                readOnly={!isEditingFirstMes}
                               value={isEditingFirstMes ? tempFirstMes : getCurrentMessage()}
                               onChange={(e) => isEditingFirstMes && setTempFirstMes(e.target.value)}
                               className={\`flex-1 w-full resize-none p-8 text-sm leading-7 outline-none font-mono custom-scrollbar bg-transparent
                                    \${theme === 'light' ? 'text-slate-700 placeholder-slate-400 selection:bg-rose-100' : 'text-gray-200 placeholder-gray-600 selection:bg-rose-500/30'}
                                    \${!isEditingFirstMes ? 'cursor-default' : ''}\`}
                               placeholder="暂无内容..."
                           />`;

const newRender = `                           {firstMesPreview && !isEditingFirstMes ? (
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
                           
code = code.replace(originalRender, newRender);

fs.writeFileSync('components/CharacterForm.tsx', code);
