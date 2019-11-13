import {Component, OnInit} from "@angular/core";
import {HttpClient} from "@angular/common/http"
import { BarcodeScanner } from 'nativescript-barcodescanner';
import { TextField } from "tns-core-modules/ui/text-field";
import { Slider } from "tns-core-modules/ui/slider";
import { ImageSource, fromBase64 } from "tns-core-modules/image-source";
import * as fileSystemModule from "tns-core-modules/file-system";
import { isAndroid, isIOS } from "tns-core-modules/platform";
import * as appSettings from "tns-core-modules/application-settings";
import * as base64 from "base-64";
import * as utf8 from "utf8";
import qrcode from 'yaqrcode';

const permissions = require("nativescript-permissions");
declare var android;

class ScannedCode {
    constructor(public uuid: string, public time: number) { }
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

@Component({
    selector: "Home",
    moduleId: module.id,
    templateUrl: "./home.component.html",
    styleUrls: ["./home.css"]
})
export class HomeComponent implements OnInit{
    scannerSelected = true;
    generatorSelected = false;
    parametersSelected = false;

    selectedColor = '#aaaaaa';
    unselectedColor = '#f3f3f3';

    credentialsName = 'credentials';
    domainName = 'domain';
    sourceEmailName = 'sourceEmail';
    resetScanningTimeName = 'resetScanningTime';
    verifiedSettingsName = 'settingsVerified';

    defaultCredentials = '';
    defaultDomain ='';
    defaultSourceEmail = '';
    minResetScanningTime: number = 60*1000;
    defaultVerifiedSettings = false;
    defaultEmailSubject = 'QR code scanned.';
    verifyingSettings = false;

    credentials = appSettings.getString(this.credentialsName, this.defaultCredentials);
    domain = appSettings.getString(this.domainName, this.defaultDomain);
    sourceEmail = appSettings.getString(this.sourceEmailName, this.defaultSourceEmail);
    resetScanningTime = appSettings.getNumber(this.resetScanningTimeName, this.minResetScanningTime);
    settingsVerified = appSettings.getBoolean(this.verifiedSettingsName, this.defaultVerifiedSettings);
    emailSubject = '';

    emailList: string[] = [];
    newEmail: string = '';
    message: string = '';
    qrImage: string;
    imageExists = false;

    emailHeader: string = "mList: ";
    headerSeparator: string= " --- ";
    messageHeader: string = "msg: ";
    emailSeparator: string = "; ";
    subjectHeader: string = "subj: ";
    idHeader: string = "uuid: ";

    stopScanning = false;

    barcodeScanner: BarcodeScanner;
    scannedCodes: ScannedCode[] = [];

    constructor(private http: HttpClient) {
        // Use the component constructor to inject providers.
    }

    ngOnInit(): void {
        // Init your component properties here.
    }

    // region home component methods.
    selectScanner() {
        if (!this.verifyingSettings) {
            this.unselectAll();
            this.scannerSelected = true;
        }
    }

    selectGenerator() {
        if (!this.verifyingSettings) {
            this.unselectAll();
            this.generatorSelected = true;
        }
    }

    selectParameters() {
        if (!this.verifyingSettings) {
            this.unselectAll();
            this.parametersSelected = true;
        }
    }

    unselectAll() {
        this.scannerSelected = false;
        this.generatorSelected = false;
        this.imageExists = false;
        this.parametersSelected = false;
    }
    // endregion

    // region scanner.
    async onContinuousScan() {
        if (!this.settingsVerified) {
            let res = await this.verifySettings();
            if (!res) {
                alert(`Could not verify settings. Please make sure that introduced ` +
                      `settings are correct and that there is internet connection. ` +
                      `If you are using sandbox please make sure that the e-mail ${this.sourceEmail} is in the ` +
                      `list of emails to which you have permission to send e-mails.`);
                return;
            }
            else {
                appSettings.setString(this.credentialsName, this.credentials);
                appSettings.setString(this.domainName, this.domain);
                appSettings.setString(this.sourceEmailName, this.sourceEmail);
            }
        }

        this.barcodeScanner = new BarcodeScanner();
        this.stopScanning = false;
        return await this.barcodeScanner.scan({
            formats: "QR_CODE",   // Pass in of you want to restrict scanning to certain types
            cancelLabel: "", // iOS only, default 'Close'
            cancelLabelBackgroundColor: "#000000", // iOS only, default '#000000' (black)
            message: "", // Android only, default is 'Place a barcode inside the viewfinder rectangle to scan it.'
            showFlipCameraButton: true,   // default false.
            preferFrontCamera: true,     // default false.
            showTorchButton: false,        // default false
            beepOnScan: true,             // Play or Suppress beep on scan (default true)
            torchOn: false,               // launch with the flashlight on (default false)
            continuousScanCallback: await this.onScan.bind(this),
            closeCallback: await this.onScannerClose.bind(this), // invoked when the scanner was closed (success or abort)
            resultDisplayDuration: 500,   // Android only, default 1500 (ms), set to 0 to disable echoing the scanned text
            orientation: "portrait",     // Android only, optionally lock the orientation to either "portrait" or "landscape"
            openSettingsIfPermissionWasPreviouslyDenied: true, // On iOS you can send the user to the settings app if access was previously denied
            reportDuplicates: true // Allows to scan the same code twice. Default is False.
        });
    }

    async onScan (result) {
        console.log('New scan.');
        await this.sendEmail.bind(this)(result.text);
        return
    }

    async onScannerClose () {
        console.log('Scanner closed.');
        return
    }

    // endregion.

    // region generator
    public changeNewEmail(args) {
        let textField = <TextField>args.object;
        this.newEmail = textField.text;
    }

    removeEmail(index) {
        this.emailList.splice(index, 1)
    }

    public changeMessage(args) {
        let textField = <TextField>args.object;
        this.message = textField.text;
    }

    addEmail() {
        this.emailList.push(this.newEmail);
        this.newEmail = "";
    }

    generateQR() {
        // If there are no specified e-mails we show an alert and stop generation.
        if (this.emailList.length == 0) {
            alert('ERROR: you must specify at least one target e-mail.');
            this.imageExists = false;
            return
        }

        // If there is currently an attempt of adding a new e-mail we show
        // an alert to prevent errors of missing added mails.
        if (this.newEmail != "") {
            alert(`WARNING: The mail ${this.newEmail} was not added to the mailing list even though it was specified.
Please add it to the e-mail list or remove it entirely.`);
            this.imageExists = false;
            return
        }

        let alertString = 'Generated qr contains the following information:';
        let qrString = '';

        qrString += this.emailHeader;
        qrString += this.emailList.join(this.emailSeparator);
        alertString += '\ne-mails: ';
        alertString += this.emailList.join(', ');

        qrString += this.headerSeparator;

        qrString += this.subjectHeader;
        qrString += this.emailSubject;
        alertString += '\nsubject: ';
        alertString += this.emailSubject;

        qrString += this.headerSeparator;

        qrString += this.messageHeader;
        qrString += this.message;
        alertString += '\nmessage: ';
        alertString += this.message;

        qrString += this.headerSeparator;

        qrString += this.idHeader;
        qrString += uuidv4();

        console.log(qrString);

        // Show an alert containing the information stored in the qr code.
        alert(alertString);

        this.qrImage = qrcode(qrString);
        this.imageExists = true;
    }

    // endregion

    // region save image.

    async saveImage(base64Image: string, fileName: string, format: "png" | "jpeg" | "jpg"){

        let base64String: string = base64Image.split('base64,')[1];
        let image: ImageSource = await fromBase64(base64String);
        fileName = fileName + '_' + getRandomString();

        let destFolder: string;
        if (isIOS) {
            destFolder = fileSystemModule.knownFolders.ios.downloads().path;
        } else if (isAndroid) {
            await permissions.requestPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE,
                "Permission needed to store generated qr codes.");
            destFolder = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS).getAbsolutePath();
        } else {
            alert("ERROR: Unrecognized platform. Could not get download directory path. " +
                "PLease consider taking a screen-shot of the generated QR code.");
            return;
        }
        let destPath = fileSystemModule.path.join(destFolder, fileName + '.' + format);

        const saved = image.saveToFile(destPath, format);
        if (saved) {
            alert("QR code saved in path " + destPath);
        } else {
            alert("ERROR: Could not save image to " + destPath);
        }
    };

    // endregion.

    // region email sending.
    getUUIDFromQr(qrString: string) {
        let uuid: string = qrString;
        if (qrString.includes(this.idHeader)) {
            uuid = qrString.split(this.headerSeparator)[3];
            uuid = uuid.replace(this.idHeader, "");
            if (uuid == undefined || uuid == '') {
                uuid = qrString;
            }
        }
        return uuid;
    }


    async sendEmail(qrString: string) {
        // Remove last scanned time from stack if enough time has passed.
        let now = new Date().getTime();
        let i = 0;
        let duplicatedScan = false;
        let codeId = this.getUUIDFromQr(qrString);
        while (i < this.scannedCodes.length) {
            let scannedCode = this.scannedCodes[i];
            console.log('passed time.');
            console.log(now - scannedCode.time);
            if (now - scannedCode.time > this.resetScanningTime) {
                this.scannedCodes.splice(i, 1);
            }
            else {
                i ++;
                if (codeId == scannedCode.uuid) {
                    duplicatedScan = true;
                }
            }
        }

        // If scan is duplicated we mark it as duplicated.
        if (duplicatedScan) {
            console.log("Duplicated qr code.");
            return
        }

        // Update Scanned codes.
        this.scannedCodes.push(new ScannedCode(codeId, now));

        console.log('Sending e-mail');

        console.log('QRMessage.');
        console.log(qrString);

        // Get target email list.
        let emailListString = qrString.split(this.headerSeparator)[0];
        emailListString = emailListString.replace(this.emailHeader, "");
        let emailList = emailListString.split(this.emailSeparator);

        //If there a re no e-mails we play an error sound and stop.
        if (emailList.length == 0) {
            return
        }

        console.log('emailList.');
        console.log(emailList);

        // Get subject.
        let subject = qrString.split(this.headerSeparator)[1];
        subject = subject.replace(this.subjectHeader, "");
        if (subject == undefined || subject == '') {
            subject = this.defaultEmailSubject;
        }

        // Get message.
        let message = qrString.split(this.headerSeparator)[2];
        message = message.replace(this.messageHeader, "");
        message += getMessageSuffix();

        console.log('Message.');
        console.log(message);

        // Convert credentials to base 64.
        let authorization: string;
        try {
            if (utf8.decode(base64.decode(this.credentials)).substr(0, 4) == 'api:') {
                authorization = this.credentials;
            } else {
                authorization = base64.encode(utf8.encode('api:' + this.credentials));
            }
        } catch (error) {
            authorization = base64.encode(utf8.encode('api:' + this.credentials));
        }

        let success: boolean = true;
        for (let i = 0; i < emailList.length; i++) {
            let email = emailList[i];
            email = email.replace(/^\s+|\s+$/g, '');
            console.log(`Sending to ${email}`);
            let ret = await this.http.post(
                `${this.domain}/messages`,
                `from=${this.sourceEmail}&to=${email}&subject=${subject}&text=${message}`,
                {
                    headers: {
                        'Authorization': `Basic ${authorization}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    responseType: 'json'
                }
            ).toPromise();
            if (ret) {
                console.log('Email sent');
            } else {
                alert(`ERROR: Unable to send message to ${email}`);
                success = false;
            }
        }

        if (success) {
            console.log('Messages sent successfully.')
        } else {
            console.log('Errors encountered while sending messages.')
        }

        return
    };
    // endregion.

    // region Settings.
    changeCredentials(args) {
        let textField = <TextField>args.object;
        this.credentials = textField.text;
        this.settingsVerified = false;
    }
    changeDomain(args) {
        let textField = <TextField>args.object;
        this.domain = textField.text;
        this.settingsVerified = false;
    }
    changeSourceMail(args) {
        let textField = <TextField>args.object;
        this.sourceEmail = textField.text;
        this.settingsVerified = false;
    }
    changeEmailSubject(args) {
        let textField = <TextField>args.object;
        this.emailSubject = textField.text;
        this.settingsVerified = false;
    }

    changeResetScanningTime(args) {
        let slider = <Slider>args.object;
        let hours = slider.value;
        this.resetScanningTime = Math.max(hours * 60 * 60 * 1000, this.minResetScanningTime)
    }

    getResetScanningHours() {
        return Math.floor(this.resetScanningTime/(1000*60*60))
    }

    getResetScanningHoursString() {
        if (this.resetScanningTime == this.minResetScanningTime) {
            return `${Math.floor(this.minResetScanningTime / (1000 * 60))} minutes.`
        }
        else {
            return `${this.getResetScanningHours()} hours.`
        }
    }

    async saveSettings() {
        let res = await this.verifySettings();
        if (res) {
            appSettings.setString(this.credentialsName, this.credentials);
            appSettings.setString(this.domainName, this.domain);
            appSettings.setString(this.sourceEmailName, this.sourceEmail);
            appSettings.setNumber(this.resetScanningTimeName, this.resetScanningTime);
            alert('settings saved');
        } else {
            alert(`Could not verify settings. Please make sure that introduced ` +
                  `settings are correct and that there is internet connection. ` +
                  `If you are using sandbox please make sure that the e-mail ${this.sourceEmail} is in the ` +
                  `list of emails to which you have permission to send e-mails.`);
        }
    }

    async verifySettings() {
        // Convert credentials to base 64.
        this.verifyingSettings = true;
        this.settingsVerified = false;
        let authorization: string;
        try {
            if (utf8.decode(base64.decode(this.credentials)).substr(0, 4) == 'api:') {
                authorization = this.credentials;
            } else {
                authorization = base64.encode(utf8.encode('api:' + this.credentials));
            }
        } catch (error) {
            authorization = base64.encode(utf8.encode('api:' + this.credentials));
        }

        console.log(`Verifying settings.`);
        let ret;
        try {
            ret = await this.http.post(
                `${this.domain}/messages`,
                `from=${this.sourceEmail}&to=${this.sourceEmail}&subject=verification&text=verified`,
                {
                    headers: {
                        'Authorization': `Basic ${authorization}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    responseType: 'json',
                }
            ).toPromise();
        } catch (err) {
            this.verifyingSettings = false;
            return false;
        }


        if (ret) {
            console.log('Settings verified.');
            this.settingsVerified = true;
            appSettings.setBoolean(this.verifiedSettingsName, this.settingsVerified);
            this.verifyingSettings = false;
            return true;
        } else {
            console.log('Error encountered while sending e-mail.');
            this.verifyingSettings = false;
            return false;
        }
    }
    // endregion.

}

function getRandomString() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}


function getMessageSuffix() {
    return "\n\n\nDO NOT ANSWER THIS MESSAGE.";
}
