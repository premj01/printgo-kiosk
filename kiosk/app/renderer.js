const { ipcRenderer } = require("electron");
const QRCode = require("qrcode");
const os = require('os');
const { send } = require("process");
const path = require('path')


const status = document.getElementById("status");
const resetButton = document.getElementById("resetButton");
const ActionImg = document.getElementById("imagetoshow");

const setQrCode = async (qrData) => {
  const qrContainer = document.getElementById("qr");
  
  //remove QR if data is null
  if(qrData === null){
    qrContainer.style.display = "none";
    ActionImg.style.display = "block";
    status.innerText = "creating new session...";
  }else{
    // show QR if data is their
    qrContainer.style.display = "block";
    ActionImg.style.display = "none";
  QRCode.toCanvas(qrContainer, qrData, { width: 300 }, function (error) {
    if (error) console.error(error);
    else console.log("QR code generated:", qrData);
  });
  }

}

resetButton.addEventListener("click" , ()=>{
  ipcRenderer.send("reset-user-session-id-kiosk-local" , {state : true} )
})


// function requestPrint() {
//   ipcRenderer.send('print-request', pdfPath);
// }

ipcRenderer.on("status", (event, msg) => {
  status.innerText = msg.text;

})
ipcRenderer.on("SetQRCode", async (event, obj) => {
  if (obj.img !== undefined) {
    await setQrCode(null);
      ActionImg.src = obj.img;
  }
  else {

    await setQrCode(`${obj.url}/kisokRedirect?userSessionNumber=${obj.kioskid}`);
    document.getElementById("kioskID").innerText = `${obj.url}/kisokRedirect?userSessionNumber=${obj.kioskid}`
  }
})












// setQrCode(qrData);
// console.log("function called " + qrData);





// setTimeout(() => {
//   status.textContent = "Downloading job...";
//   setQrCode("hi");
// }, 3000);
// setTimeout(() => {
//   setQrCode("hiifrfsrgsdvjdfvbsfvibsi e feofuinw o egfn orgn ergosbnrgowe  grfer greg ergergerg rgergrg");
//   status.textContent = "Printing...";
// }, 6000);
// setTimeout(() => {
//   status.textContent = "Job completed!";
//   setQrCode(123)
// }, 9000);


