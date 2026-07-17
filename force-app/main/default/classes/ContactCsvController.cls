public with sharing class ContactCsvController {

    @AuraEnabled
    public static List<Contact> getContactsForAccount(Id accountId) {
        return [SELECT Id, FirstName, LastName, Birthdate, Email, MobilePhone, Phone,
                       MailingStreet, MailingCity, MailingState, MailingPostalCode
                FROM Contact
                WHERE AccountId = :accountId
                WITH USER_MODE];
    }

    @AuraEnabled
    public static String saveDynamicContacts(String contactsJson, Id accountId) {
        try {
            List<Object> rawList = (List<Object>) JSON.deserializeUntyped(contactsJson);
            List<Map<String, Object>> csvDataRows = new List<Map<String, Object>>();
            for (Object obj : rawList) {
                csvDataRows.add((Map<String, Object>) obj);
            }

            Schema.SObjectType targetType = Schema.getGlobalDescribe().get('Contact');
            Map<String, Schema.SObjectField> fieldMap = targetType.getDescribe().fields.getMap();

            List<Contact> contactsToInsert = new List<Contact>();
            List<Contact> contactsToUpdate = new List<Contact>();

            for (Map<String, Object> row : csvDataRows) {
                Contact con = new Contact();
                Boolean hasId = false;
                con.AccountId = accountId;

                for (String columnHeader : row.keySet()) {
                    String fieldApiName = columnHeader.trim();
                    Object rawValue = row.get(columnHeader);

                    // --- Handle Id FIRST, outside of the FLS gate ---
                    // Id.isCreateable()/isUpdateable() are always false via describe,
                    // so this must never be routed through the generic field check below.
                    if (fieldApiName.equalsIgnoreCase('Id')) {
                        String idStr = rawValue != null ? String.valueOf(rawValue).trim() : null;
                        if (String.isNotBlank(idStr)) {
                            try {
                                con.Id = (Id) idStr;
                                hasId = true;
                            } catch (System.StringException se) {
                                // Not a valid 15/18-char Id (e.g. a stray "temp_" value slipped through) -
                                // treat as a new record rather than failing the whole batch.
                            }
                        }
                        continue;
                    }

                    // --- Generic dynamic field assignment (FLS-checked) ---
                    if (fieldMap.containsKey(fieldApiName)) {
                        Schema.DescribeFieldResult fieldDescribe = fieldMap.get(fieldApiName).getDescribe();
                        if (fieldDescribe.isCreateable() || fieldDescribe.isUpdateable()) {
                            con.put(fieldApiName, castValue(rawValue, fieldDescribe.getType()));
                        }
                    }
                }

                if (hasId) {
                    contactsToUpdate.add(con);
                } else {
                    contactsToInsert.add(con);
                }
            }

            String dmlSummary = '';
            if (!contactsToInsert.isEmpty()) {
                insert contactsToInsert;
                dmlSummary += 'Created ' + contactsToInsert.size() + ' new contacts. ';
            }
            if (!contactsToUpdate.isEmpty()) {
                update contactsToUpdate;
                dmlSummary += 'Updated ' + contactsToUpdate.size() + ' existing contacts.';
            }

            return dmlSummary;

        } catch (Exception e) {
            throw new AuraHandledException(e.getMessage());
        }
    }

    private static Object castValue(Object rawVal, Schema.DisplayType fieldType) {
        if (rawVal == null) return null;
        String valStr = String.valueOf(rawVal);
        if (String.isBlank(valStr)) return null;

        if (fieldType == Schema.DisplayType.DOUBLE || fieldType == Schema.DisplayType.CURRENCY) {
            return Decimal.valueOf(valStr);
        } else if (fieldType == Schema.DisplayType.INTEGER) {
            return Integer.valueOf(valStr);
        } else if (fieldType == Schema.DisplayType.BOOLEAN) {
            return Boolean.valueOf(valStr);
        } else if (fieldType == Schema.DisplayType.DATE) {
            return Date.valueOf(valStr);
        } else if (fieldType == Schema.DisplayType.DATETIME) {
            return DateTime.valueOf(valStr);
        }
        return valStr;
    }
}