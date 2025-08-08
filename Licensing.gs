/**
 * Linked Slides Add-on - Google Apps Script server-side code.
 * Copyright (C) 2025 Green Duck Punch, LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * This file is part of the Linked Slides Add-on. The Linked Slides Add-on is
 * dual-licensed under the AGPLv3 and a commercial/proprietary license.
 * For a proprietary license, please contact Green Duck Punch, LLC.
 * 
 * @OnlyCurrentDoc
 *
 * The above tag tells Google Apps Script that this script is only intended
 * to be run from within the Google Slides document it is bound to.
 *
 * Licensing and subscription management for the Linked Slides Add-on.
 * This file handles trial periods, Paddle subscription checks, and caching.
 */

/**
 * Configuration object for licensing.
 * Retrieves settings from Script Properties. It's recommended to set these
 * in Project Settings > Script Properties.
 *
 * @returns {object} The configuration object.
 */
function _getLicensingConfig() {
  const properties = PropertiesService.getScriptProperties();
  const propsObj = properties.getProperties()
  const config = {
    // --- Paddle API Configuration ---
    // Get these from your Paddle dashboard.
    PADDLE_API_KEY: propsObj['PADDLE_API_KEY'],
    PADDLE_API_BASE_URL: (propsObj['PADDLE_API_BASE_URL'] || 'https://api.paddle.com').replace(/\/$/, ''),
    PADDLE_FRONTEND_TOKEN: propsObj['PADDLE_FRONTEND_TOKEN'],
    PADDLE_ENVIRONMENT: propsObj['PADDLE_ENVIRONMENT'] || 'production',

    // --- Product Configuration ---
    // The ID of your individual subscription product in Paddle.
    PADDLE_INDIVIDUAL_PRODUCT_ID: propsObj['PADDLE_INDIVIDUAL_PRODUCT_ID'],
    // The ID of your individual subscription price in Paddle.
    PADDLE_INDIVIDUAL_PRICE_ID: propsObj['PADDLE_INDIVIDUAL_PRICE_ID'],
    // The ID of your bulk/team subscription product in Paddle.
    PADDLE_BULK_PRODUCT_ID: propsObj['PADDLE_BULK_PRODUCT_ID'],
    // The URL for the checkout page, pre-configured in Paddle.
    PADDLE_CHECKOUT_URL: propsObj['PADDLE_CHECKOUT_URL'],

    // --- Behavior Configuration ---
    // Trial period in seconds for new users. Default is 7 days (604800 seconds).
    TRIAL_PERIOD_SECONDS: parseInt(propsObj['TRIAL_PERIOD_SECONDS'] || '604800', 10),
    // How long to cache a user's "licensed" status in seconds (e.g., 3600 = 1 hour).
    LICENSED_USER_CACHE_EXPIRATION_SECONDS: parseInt(propsObj['LICENSED_USER_CACHE_EXPIRATION_SECONDS'] || '3600', 10),
    // How long to grant access if an error occurs, in seconds (e.g., 86400 = 24 hours).
    ERROR_GRACE_PERIOD_SECONDS: parseInt(propsObj['ERROR_GRACE_PERIOD_SECONDS'] || '86400', 10),
    // How long to cache the domain-to-subscription map, in seconds (e.g., 3600 = 1 hour).
    BULK_LICENSE_DOMAIN_MAP_CACHE_EXPIRATION_SECONDS: parseInt(propsObj['BULK_LICENSE_DOMAIN_MAP_CACHE_EXPIRATION_SECONDS'] || '3600', 10),

    // --- RevenueCat Configuration (Optional) ---
    REVENUECAT_API_KEY: propsObj['REVENUECAT_API_KEY'],
    REVENUECAT_APP_USER_ID_PREFIX: propsObj['REVENUECAT_APP_USER_ID_PREFIX'] || 'linked_slides:',
    REVENUECAT_ENTITLEMENT_ID: propsObj['REVENUECAT_ENTITLEMENT_ID'],
    REVENUECAT_API_VERSION: propsObj['REVENUECAT_API_VERSION'] || '2024-05-29',
  };

  config.LOCK_TIMEOUT_MS = parseInt(propsObj['LOCK_TIMEOUT_MS'] || '30000', 10); // Default to 30 seconds
  return config;
}

/**
 * Main entry point for license enforcement. Called by other functions.
 * Returns true if the user is licensed, otherwise shows a dialog and returns false.
 *
 * @returns {boolean} True if licensed and can proceed, false otherwise.
 */
function _enforceLicense() {
  const userEmail = Session.getActiveUser().getEmail();

  const licenseStatus = _isUserLicensed(userEmail);

  if (licenseStatus.licensed) {
    return true;
  } else {
    _showLicensingDialog(userEmail);
    return false;
  }
}

/**
 * Checks if a user is licensed by checking cache, trial status, and Paddle.
 *
 * @param {string} userEmail The email of the user to check.
 * @returns {{licensed: boolean}} An object indicating license status.
 */
function _isUserLicensed(userEmail) {
  const config = _getLicensingConfig();
  const userCache = CacheService.getUserCache();

  // 1. Check user-specific cache first for performance, if caching is enabled.
  if (config.LICENSED_USER_CACHE_EXPIRATION_SECONDS > 0 && userCache.get('is_licensed') === 'true') {
    return { licensed: true };
  }

  // 2. Check if the user is within their trial period.
  if (_checkAndSetTrialStatus()) {
    return { licensed: true };
  }

  // 3. Check with Paddle or RevenueCat
  try {
    if (_checkForLicense(userEmail)) {
      // Cache the positive result.
      userCache.put('is_licensed', 'true', config.LICENSED_USER_CACHE_EXPIRATION_SECONDS);
      return { licensed: true };
    }
  } catch (e) {
    consoleError_(`License check failed`, e);
    // Grant a grace period if Paddle is down.
    userCache.put('is_licensed', 'true', config.ERROR_GRACE_PERIOD_SECONDS);
    return { licensed: true };
  }

  // 4. If all checks fail, the user is not licensed.
  return { licensed: false };
}

/**
 * Checks, and if necessary, sets the trial period start date for a new user.
 *
 * @returns {boolean} True if the user is currently within their trial period.
 */
function _checkAndSetTrialStatus() {
  const config = _getLicensingConfig();
  const userProperties = PropertiesService.getUserProperties();
  const firstUseTimestamp = userProperties.getProperty('first_use_timestamp');

  if (!firstUseTimestamp) {
    // First time user, start the trial.
    userProperties.setProperty('first_use_timestamp', new Date().getTime().toString());
    return true;
  }

  const trialEndDate = parseInt(firstUseTimestamp, 10) + (config.TRIAL_PERIOD_SECONDS * 1000);
  return new Date().getTime() < trialEndDate;
}


/**
 * Checks for license using RevenueCat if configured, otherwise falls back to Paddle.
 *
 * @param {string} userEmail The user's email address.
 * @returns {boolean | 'grace'} True if licensed, 'grace' for Paddle API error grace period, otherwise false.
 */
function _checkForLicense(userEmail) {
  const config = _getLicensingConfig();
  const usingRevenueCat = config.REVENUECAT_API_KEY && config.REVENUECAT_ENTITLEMENT_ID;

  if (usingRevenueCat) {
    return _checkRevenueCatEntitlement(userEmail);
  } else {
    return _checkPaddleLicense(userEmail);
  }
}



/**
 * Orchestrates checking for individual and bulk licenses with Paddle.
 *
 * @param {string} userEmail The user's email address.
 * @returns {boolean} True if a valid license is found.
 */
function _checkPaddleLicense(userEmail) {
  const config = _getLicensingConfig();
  const requiredProperties = [
    'PADDLE_API_KEY',
    'PADDLE_INDIVIDUAL_PRODUCT_ID',
    'PADDLE_BULK_PRODUCT_ID',
    'PADDLE_CHECKOUT_URL',
    'PADDLE_FRONTEND_TOKEN',
    'PADDLE_INDIVIDUAL_PRICE_ID',
  ];

  const missingProperties = requiredProperties.filter(prop => !config[prop]);

  if (missingProperties.length > 0) {
    const errorMessage = `Paddle configuration is incomplete. The following script properties are not set: ${missingProperties.join(', ')}. ` +
      'Please configure them in your Apps Script project settings. Granting temporary access.';
    consoleError_(errorMessage);
    // Throwing an error here will be caught by _isUserLicensed and treated as a Paddle API failure,
    // which correctly grants a grace period to the user.
    throw new Error('Missing Paddle configuration; granting grace period.');
  }

  // Check for an active individual subscription.
  if (_findIndividualSubscription(userEmail)) {
    return true;
  }

  // Check for an active bulk/team subscription.
  if (_findAndClaimBulkLicense(userEmail)) {
    return true;
  }

  return false;
}

/**
 * Finds if a user has an active individual subscription.
 *
 * @param {string} email The user's email.
 * @returns {boolean} True if an active subscription is found.
 */
function _findIndividualSubscription(email) {
  const config = _getLicensingConfig();

  // Find customer by email
  const customerResponse = _paddleApiRequest(`/customers?email=${encodeURIComponent(email)}`);
  if (!customerResponse || customerResponse.data.length === 0) {
    return false;
  }
  const customerId = customerResponse.data[0].id;

  // Find active subscriptions for that customer
  const subsResponse = _paddleApiRequest(`/subscriptions?customer_id=${customerId}&status=active,trialing`);
  if (!subsResponse || subsResponse.data.length === 0) {
    return false;
  }

  // Check if any of the active subscriptions are for our product
  return subsResponse.data.some(sub =>
    sub.items.some(item => item.price && item.price.product_id === config.PADDLE_INDIVIDUAL_PRODUCT_ID)
  );
}

/**
 * Finds an available bulk license for the user's domain and claims a seat if available.
 *
 * @param {string} userEmail The user's email.
 * @returns {boolean} True if a seat was found or claimed.
 */
function _findAndClaimBulkLicense(userEmail) {
  const config = _getLicensingConfig();
  const domain = userEmail.split('@')[1];
  if (!domain) return false;

  const domainMap = _getBulkLicenseDomainMap();
  const subscriptionIds = domainMap[domain.toLowerCase()];

  if (!subscriptionIds || subscriptionIds.length === 0) {
    return false;
  }

  for (const subId of subscriptionIds) {
    const lock = LockService.getScriptLock();
    try {
      if (!lock.tryLock(config.LOCK_TIMEOUT_MS)) {
        consoleWarn_(`Could not acquire lock for subId ${subId} and user ${userEmail} within ${config.LOCK_TIMEOUT_MS} ms. Considering user licensed.`);
        // Return true here, assuming the user is licensed if we can't get the lock in time
        return true;
      }

      // If we got the lock, proceed with the license check
      const subResponse = _paddleApiRequest(`/subscriptions/${subId}`);
      const subscription = subResponse.data;

      if (!['active', 'trialing'].includes(subscription.status)) continue;

      const customData = subscription.custom_data || {};
      let licensedUsers = customData.licensed_users || [];

      if (licensedUsers.map(u => u.toLowerCase()).includes(userEmail.toLowerCase())) {
        return true; // Found existing license.
      }

      // Calculate license limit by summing quantities of items matching the bulk product ID.
      const licenseLimit = subscription.items
        .filter(item => item.price && item.price.product_id === config.PADDLE_BULK_PRODUCT_ID)
        .reduce((total, item) => total + item.quantity, 0);

      // Ensure licensedUsers is an array before pushing
      if (!Array.isArray(licensedUsers)) {
        licensedUsers = [];
      }

      // Ensure no duplicates after update.
      licensedUsers = [...new Set(licensedUsers)];

      if (licensedUsers.length < licenseLimit) {
        const updatedUsers = [...licensedUsers, userEmail];
        const success = _updateSubscriptionCustomData(subId, { ...customData, licensed_users: updatedUsers });
        if (success) {
          CacheService.getScriptCache().remove('bulk_license_domain_map');
          return true;
        }
      }
    } catch (e) {
      consoleError_(`Failed to check or claim bulk license for subscription ${subId}`, e);
    } finally {
      if (lock.hasLock()) lock.releaseLock(); // Release only if we actually acquired it
    }

  }

  return false;
}

/**
 * Builds or retrieves from cache a map of domains to bulk subscription IDs.
 *
 * @returns {Object.<string, string[]>} A map where keys are domains and values are arrays of subscription IDs.
 */
function _getBulkLicenseDomainMap() {
  const config = _getLicensingConfig();
  const scriptCache = CacheService.getScriptCache();
  const cacheKey = 'bulk_license_domain_map';

  const cachedMap = scriptCache.get(cacheKey);
  if (cachedMap) {
    return JSON.parse(cachedMap);
  }

  const domainMap = {};
  let hasMore = true;
  let nextUrl = `/subscriptions?status=active,trialing&product_id=${config.PADDLE_BULK_PRODUCT_ID}&per_page=100`;

  while (hasMore) {
    const response = _paddleApiRequest(nextUrl);

    response.data.forEach(sub => {
      const customData = sub.custom_data;
      if (customData && customData.allowed_domains) {
        const allowed_domains = customData.allowed_domains.split(/(\s|,)+/);
        allowed_domains.forEach(domain => {
          const lowerDomain = domain.toLowerCase();
          if (!domainMap[lowerDomain]) {
            domainMap[lowerDomain] = [];
          }
          domainMap[lowerDomain].push(sub.id);
        });
      }
    });

    if (response.meta && response.meta.pagination && response.meta.pagination.has_more) {
      const fullNextUrl = response.meta.pagination.next;
      nextUrl = fullNextUrl.substring(config.PADDLE_API_BASE_URL.length);
    } else {
      hasMore = false;
    }
  }

  scriptCache.put(cacheKey, JSON.stringify(domainMap), config.BULK_LICENSE_DOMAIN_MAP_CACHE_EXPIRATION_SECONDS);
  return domainMap;
}

/**
 * Updates the custom_data field for a given Paddle subscription.
 *
 * @param {string} subscriptionId The ID of the subscription to update.
 * @param {object} customData The new custom data object.
 * @returns {boolean} True on success.
 */
function _updateSubscriptionCustomData(subscriptionId, customData) {
  try {
    _paddleApiRequest(`/subscriptions/${subscriptionId}`, 'PATCH', { custom_data: customData });
    consoleLog_(`Successfully updated custom_data for subscription ${subscriptionId}.`);
    return true;
  } catch (e) {
    consoleError_(`Failed to update custom_data for subscription ${subscriptionId}`, e);
    return false;
  }
}

/**
 * A generic wrapper for making authorized requests to the Paddle API.
 *
 * @param {string} endpoint The API endpoint (e.g., '/customers').
 * @param {string} [method='GET'] The HTTP method.
 * @param {object} [payload=null] The request payload for POST/PATCH.
 * @returns {object} The parsed JSON response.
 */
function _paddleApiRequest(endpoint, method = 'GET', payload = null) {
  const config = _getLicensingConfig();
  const options = {
    method: method,
    headers: {
      'Authorization': `Bearer ${config.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const fullUrl = config.PADDLE_API_BASE_URL + endpoint;
  const response = UrlFetchApp.fetch(fullUrl, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    return JSON.parse(responseBody);
  } else {
    const errorMessage = `Paddle API Error: Request to '${method} ${fullUrl}' failed. ` +
      `Payload: ${options.payload || 'N/A'}. Response: ${responseCode} - ${responseBody}`;
    throw new Error(errorMessage);
  }
}

/**
 * Generates a pre-filled Paddle checkout URL for the user.
 *
 * @param {string} userEmail The user's email.
 * @returns {string} The checkout URL.
 */
function _getCheckoutUrl(userEmail) {
  const config = _getLicensingConfig();
  const checkoutUrl = config.PADDLE_CHECKOUT_URL;
  const separator = checkoutUrl.includes('?') ? '&' : '?';
  return `${checkoutUrl}${separator}user_email=${encodeURIComponent(userEmail)}`;
}

/**
 * Displays a modal dialog prompting the user to purchase a license.
 *
 * @param {string} email The current user's email.
 */
function _showLicensingDialog(email) {
  const template = HtmlService.createTemplateFromFile('LicensingDialog');
  const config = _getLicensingConfig();
  template.checkoutUrl = _getCheckoutUrl(email);
  // Pass the email in a stringified JSON object so it can be safely injected into the javascript even if it happens to contain strange characters.
  template.userEmail = email;
  template.config = config;

  const htmlOutput = template.evaluate()
    .setWidth(550)
    .setHeight(450)
    .setTitle('Subscription Required');
  SlidesApp.getUi().showModalDialog(htmlOutput, 'Subscription Required');
}

/**
 * Checks if a user has an active entitlement in RevenueCat.
 * @param {string} userEmail The user's email.
 * @returns {boolean} True if the user has the entitlement, false otherwise.
 */
function _checkRevenueCatEntitlement(userEmail) {
  const config = _getLicensingConfig();
  const appUserId = config.REVENUECAT_APP_USER_ID_PREFIX + userEmail;

  const response = _revenueCatApiRequest(`/subscribers/${encodeURIComponent(appUserId)}`);
  const entitlements = response.entitlements;

  if (entitlements && entitlements[config.REVENUECAT_ENTITLEMENT_ID] && entitlements[config.REVENUECAT_ENTITLEMENT_ID].is_active) {
    return true;
  }
  return false;
}

/**
 * Makes a request to the RevenueCat API.
 * @param {string} endpoint The API endpoint.
 * @param {string} method The HTTP method (default: 'GET').
 * @param {object} payload The request payload (for POST/PUT requests).
 * @returns {object} The parsed JSON response from the API.
 */
function _revenueCatApiRequest(endpoint, method = 'GET', payload = null) {
  const config = _getLicensingConfig();
  const url = 'https://api.revenuecat.com/v1' + endpoint;
  const options = {
    method: method,
    headers: {
      'Authorization': `Bearer ${config.REVENUECAT_API_KEY}`,
      'X-RevenueCat-Version': config.REVENUECAT_API_VERSION,
      'Content-Type': 'application/json',
    },
    muteHttpExceptions: true,
  };

  if (payload) {
    options.payload = JSON.stringify(payload);
  }

  const fullUrl = 'https://api.revenuecat.com/v1' + endpoint;
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode >= 200 && responseCode < 300) {
    return JSON.parse(responseBody);
  } else {
    const errorMessage = `RevenueCat API Error: Request to '${method} ${fullUrl}' failed. ` +
      `Payload: ${options.payload || 'N/A'}. Response: ${responseCode} - ${responseBody}`;
    throw new Error(errorMessage);
  }
}