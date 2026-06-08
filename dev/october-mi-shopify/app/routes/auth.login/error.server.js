import { LoginErrorType } from "@shopify/shopify-app-remix/server";

/**
 * Map the structured login error returned by `login(request)` into
 * field-level messages the Polaris form can render.
 */
export function loginErrorMessage(loginErrors) {
  if (loginErrors?.shop === LoginErrorType.MissingShop) {
    return { shop: "Please enter your shop domain to log in" };
  } else if (loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "Please enter a valid shop domain to log in" };
  }

  return {};
}
