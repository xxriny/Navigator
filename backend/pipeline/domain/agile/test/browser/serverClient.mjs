// Browser fixture only: keep every request on the loopback test server.
export const SERVER_URL=window.location.origin;
export async function serverRequest(path,options={}) {
  const response=await fetch(path,options);const data=await response.json();
  if(!response.ok)throw new Error(data.detail||"Test request failed");return data;
}
