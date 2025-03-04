const { exec } = require('child_process');
const fs = require('fs');

function printViaBrotherPrinter(printerName = 'Brother_HL_L2370DW_series') {
  // Create a test print file with more diagnostic information
  const testFilePath = './brother-test-print.txt';
  
  const testContent = `Brother Printer Diagnostic Print
  ==================================
  Date: ${new Date().toLocaleString()}
  Printer: ${printerName}
  
  Printer Connectivity Test
  ==================================
  Full system diagnostic information`;

  fs.writeFileSync(testFilePath, testContent);

  // Print command with verbose options
  exec(`lpr -P "${printerName}" "${testFilePath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Printing error: ${error}`);
      console.error(`stderr: ${stderr}`);
      return;
    }
    
    console.log('Print job sent successfully');
    
    // Additional printer status check
    exec('lpstat -p', (statusError, statusStdout, statusStderr) => {
      console.log('Printer Status:');
      console.log(statusStdout);
    });
  });
}

// Run the print test
printViaBrotherPrinter();