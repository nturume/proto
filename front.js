const prepbtn = document.getElementById("prepbtn");
const runbtn = document.getElementById("runbtn");
const konsole = document.getElementById("console");

runbtn.disabled = true;

const platform = window.api.getPlatform();
var prepared = false;
var needrestart = false;


prepbtn.addEventListener("click", async (e) => {
  try {
    await platform.prepareVM((dp) => {
      if(dp=="whpx is off...") needrestart = true;
      console.log(dp);
      konsole.innerText = dp;
    });
    console.log("Hello world", platform.getDetails());
    prepared = true;
    runbtn.disabled = false;
  } catch (e) {
    alert(`${e.toString()}`);
  }
})

runbtn.addEventListener("click", async (e) => {
  if (!prepared) {
    alert("Virtual Machine not prepared.");
    return;
  }
  if(needrestart) {
    alert("Please restart your computer to finish enabling Hardware Acceleration.");
    return;
  }
  try {
    platform.runVM();
  } catch (e) {
    alert(`${e.toString()}`);
  }
  console.log("Hello world", platform.getDetails());
})
