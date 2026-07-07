const fs = require('fs');
let lines = fs.readFileSync('components/CharacterForm.tsx', 'utf8').split('\n');

// 1160 is `                                </>\r` or `                                </>\n`
// I'll replace lines from 1162 (index 1161) to 1172 (index 1171).

const replacement = `                                    <button 
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
                                        }}
                                        className={\`p-2 rounded-full transition \${theme === 'light' ? 'hover:bg-slate-100 text-slate-500' : 'hover:bg-white/10 text-gray-400'}\`}
                                        title="编辑"
                                    >
                                        <Pen size={18} />
                                    </button>`;

lines.splice(1162, 10, replacement);

fs.writeFileSync('components/CharacterForm.tsx', lines.join('\n'));
