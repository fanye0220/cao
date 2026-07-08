const html = `
    const repPreview=document.createElement('code');
    repPreview.className='regex-code';
    const repFull=s.replace||'';
    const preview=repFull.substring(0,80)+(repFull.length>80?'…':'');
    repPreview.textContent=preview;
    repRow.appendChild(repPreview);
    if(repFull.length>80){
      const expand=document.createElement('span');
      expand.className='regex-expand'; expand.textContent='展开';
      let expanded=false;
      expand.onclick=()=>{
        expanded=!expanded;
        repPreview.textContent=expanded?repFull:preview;
        expand.textContent=expanded?'收起':'展开';
      };
      repRow.appendChild(expand);
    }
`;
console.log("Found expand code in user's HTML");
