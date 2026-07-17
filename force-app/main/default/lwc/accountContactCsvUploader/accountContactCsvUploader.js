import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { RefreshEvent } from 'lightning/refresh';
import getContactsForAccount from '@salesforce/apex/ContactCsvController.getContactsForAccount';
import saveDynamicContacts from '@salesforce/apex/ContactCsvController.saveDynamicContacts';

export default class AccountContactCsvUploader extends LightningElement {
    @api recordId;
    @track csvData = [];
    @track draftValues = [];
    @track columns = [];
    showTable = false;
    isUploading = false;
    isDragActive = false;
    fileName = '';

    get isUploadDisabled() {
        return !this.showTable || this.isUploading;
    }
    get recordCount() {
        return this.csvData.length;
    }
    get dropZoneClass() {
        return this.isDragActive ? 'drop-zone drop-zone-active' : 'drop-zone';
    }

    triggerFileInput() {
        this.refs.fileInput.click();
    }

    // --- OPTION A: LOAD FROM SF ---
    loadExistingContacts() {
        getContactsForAccount({ accountId: this.recordId })
            .then(result => {
                if (result && result.length > 0) {
                    this.csvData = result.map(con => ({ id: con.Id, ...con }));
                    this.generateDynamicColumns(result[0]);
                    this.showTable = true;
                    this.draftValues = [];
                    this.fileName = '';
                } else {
                    this.showToast('Info', 'No contacts found for this account to download.', 'info');
                }
            })
            .catch(error => {
                this.showToast('Error', 'Failed to retrieve contacts: ' + error.body.message, 'error');
            });
    }

    // --- OPTION B: UPLOAD FROM LOCAL CSV (file picker) ---
    handleFileUpload(event) {
        const file = event.target.files[0];
        if (file) {
            this.processFile(file);
        }
        event.target.value = '';
    }

    // --- OPTION B (cont.): UPLOAD FROM LOCAL CSV (drag & drop) ---
    handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        this.isDragActive = true;
    }

    handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        this.isDragActive = false;
    }

    handleDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        this.isDragActive = false;

        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length > 0) {
            this.processFile(files[0]);
        }
    }

    processFile(file) {
        if (!file.name || !file.name.toLowerCase().endsWith('.csv')) {
            this.showToast('Error', 'Please upload a .csv file.', 'error');
            return;
        }

        this.fileName = file.name;

        const reader = new FileReader();
        reader.onload = () => {
            this.parseCsv(reader.result);
        };
        reader.onerror = () => {
            this.showToast('Error', 'Failed to read the selected file.', 'error');
        };
        reader.readAsText(file);
    }

    parseCsv(csvText) {
        csvText = csvText.replace(/^\uFEFF/, '');

        const lines = csvText.split(/\r\n|\n/);
        const headers = this.parseCsvLine(lines[0]).map(header => header.trim());
        const parsedData = [];

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;

            const currentLine = this.parseCsvLine(lines[i]);
            const rowObj = { id: 'temp_' + i };

            for (let j = 0; j < headers.length; j++) {
                let rawValue = currentLine[j] !== undefined ? currentLine[j].trim() : '';

                if (headers[j].toLowerCase() === 'id') {
                    rowObj['Id'] = rawValue;
                } else {
                    rowObj[headers[j]] = rawValue;
                }
            }
            parsedData.push(rowObj);
        }

        if (parsedData.length > 0) {
            this.csvData = parsedData;
            this.generateDynamicColumns(parsedData[0]);
            this.showTable = true;
            this.draftValues = [];
        } else {
            this.showToast('Error', 'No data rows found in the CSV.', 'error');
        }
    }

    parseCsvLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);

        return result.map(field => field.replace(/^"|"$/g, ''));
    }

    generateDynamicColumns(sampleRecord) {
        const ignoredKeys = ['id'];
        const dynamicCols = [];

        if (Object.prototype.hasOwnProperty.call(sampleRecord, 'Id') || Object.prototype.hasOwnProperty.call(sampleRecord, 'id')) {
            dynamicCols.push({ label: 'Record ID', fieldName: 'Id', editable: false });
        }

        Object.keys(sampleRecord).forEach(key => {
            if (!ignoredKeys.includes(key) && key.toLowerCase() !== 'id') {
                dynamicCols.push({
                    label: this.formatLabel(key),
                    fieldName: key,
                    editable: true
                });
            }
        });
        this.columns = dynamicCols;
    }

    formatLabel(apiName) {
        return apiName.replace(/([A-Z])/g, ' $1').trim();
    }

    handleCellChange(event) {
        let updatedDrafts = [...this.draftValues];

        event.detail.draftValues.forEach(newChange => {
            const existingRowIndex = updatedDrafts.findIndex(draft => draft.id === newChange.id);
            if (existingRowIndex !== -1) {
                updatedDrafts[existingRowIndex] = { ...updatedDrafts[existingRowIndex], ...newChange };
            } else {
                updatedDrafts.push(newChange);
            }
        });

        this.draftValues = updatedDrafts;
    }

    getMergedData() {
        let mergedRecords = JSON.parse(JSON.stringify(this.csvData));
        this.draftValues.forEach(draft => {
            const index = mergedRecords.findIndex(item => item.id === draft.id);
            if (index !== -1) {
                mergedRecords[index] = { ...mergedRecords[index], ...draft };
            }
        });
        return mergedRecords;
    }

    handleDownloadCsv() {
        const dataToExport = this.getMergedData();
        if (dataToExport.length === 0) return;

        const csvHeaders = ['Id', ...this.columns.filter(col => col.fieldName !== 'Id').map(col => col.fieldName)];

        const csvRows = [];
        csvRows.push(csvHeaders.join(','));

        dataToExport.forEach(row => {
            const values = csvHeaders.map(header => {
                let value = '';
                if (header === 'Id') {
                    value = row.Id || (!String(row.id).startsWith('temp_') ? row.id : '');
                } else {
                    value = row[header] !== undefined && row[header] !== null ? row[header] : '';
                }

                const stringValue = String(value);
                if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
                    return `"${stringValue.replace(/"/g, '""')}"`;
                }
                return stringValue;
            });
            csvRows.push(values.join(','));
        });

        const csvContent = csvRows.join('\r\n');

        try {
            const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'application/octet-stream' });
            const blobUrl = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.setAttribute('download', 'Contacts_Export.csv');
            link.style.visibility = 'hidden';

            document.body.appendChild(link);
            link.click();

            document.body.removeChild(link);
            URL.revokeObjectURL(blobUrl);

            this.showToast('Success', 'CSV downloaded successfully with ID tracking.', 'success');
        } catch (error) {
            this.showToast('Error', 'Failed to generate download link: ' + error.message, 'error');
        }
    }

    handleCompleteUpload() {
        this.isUploading = true;
        let finalRecords = this.getMergedData();

        finalRecords = finalRecords.map(record => {
            const cleanRecord = { ...record };
            const actualId = cleanRecord.Id || cleanRecord.id || cleanRecord.ID;

            if (!actualId || String(actualId).trim() === '' || String(actualId).startsWith('temp_')) {
                delete cleanRecord.id;
                delete cleanRecord.Id;
                delete cleanRecord.ID;
            } else {
                cleanRecord.Id = String(actualId).trim();
                delete cleanRecord.id;
                delete cleanRecord.ID;
            }
            return cleanRecord;
        });

        saveDynamicContacts({
            contactsJson: JSON.stringify(finalRecords),
            accountId: this.recordId
        })
            .then(result => {
                this.showToast('Success', result, 'success');
                this.dispatchEvent(new RefreshEvent());
                this.handleCancel(); // reset panel back to empty state
                this.isUploading = false;
            })
            .catch(error => {
                this.showToast('Error', error.body ? error.body.message : error.message, 'error');
                this.isUploading = false;
            });
    }

    //CANCEL

    handleCancel() {
        this.csvData = [];
        this.draftValues = [];
        this.columns = [];
        this.showTable = false;
        this.fileName = '';
        this.isDragActive = false;
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}