/** Only an Escape navigation signal crosses the isolated preview boundary. */
export const previewEscapeMessage = "apsis:preview:escape";
export const previewEscapeScript = `<script>window.addEventListener("keydown",function(event){if(event.key==="Escape"&&!event.defaultPrevented)parent.postMessage(${JSON.stringify(previewEscapeMessage)},"*")});</script>`;
