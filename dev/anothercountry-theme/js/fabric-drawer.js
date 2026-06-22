(function ($) {
  "use strict";
  function getVariationData($form) {
    var variations = $form.data("product_variations");
    return Array.isArray(variations) ? variations : [];
  }
  function getCurrentAttributes($form) {
    var attrs = {};
    $form.find("select[name^='attribute_']").each(function () {
      attrs[$(this).attr("name")] = $(this).val() || "";
    });
    return attrs;
  }
  function candidateScore(variation, current) {
    var score = 0;
    Object.keys(current).forEach(function (key) {
      if (!current[key]) {
        return;
      }
      if (variation.attributes[key] === current[key]) {
        score += 2;
      } else if (variation.attributes[key] === "") {
        score += 1;
      } else {
        score -= 10;
      }
    });
    if (variation.is_in_stock) {
      score += 1;
    }
    return score;
  }
  function findBestVariationForFabric($form, fabricSlug) {
    var variations = getVariationData($form);
    var current = getCurrentAttributes($form);
    var candidates = variations.filter(function (variation) {
      return variation.attributes.attribute_pa_fabric === fabricSlug;
    });
    if (!candidates.length) {
      return null;
    }
    candidates.sort(function (a, b) {
      return candidateScore(b, current) - candidateScore(a, current);
    });
    return candidates[0];
  }
  function setVariationFromCandidate($form, candidate) {
    if (!candidate || !candidate.attributes) {
      return;
    }
    Object.keys(candidate.attributes).forEach(function (attrKey) {
      var value = candidate.attributes[attrKey];
      if (!value) {
        return;
      }
      var $select = $form.find("select[name='" + attrKey + "']");
      if (!$select.length || $select.val() === value) {
        return;
      }
      $select.val(value).trigger("change");
    });
  }
  function setSwatchState($scope, fabricSlug) {
    $scope.find(".ac-fabric-swatch").removeClass("is-active");
    $scope.find(".ac-fabric-swatch[data-fabric-slug='" + fabricSlug + "']").addClass("is-active");
  }
  function syncBodyDrawerClass() {
    $("body").toggleClass("ac-fabric-drawer-open", $(".ac-fabric-drawer.ac-is-open").length > 0);
  }
  function closeDrawer($drawer, $backdrop) {
    $drawer.removeClass("ac-is-open").attr("aria-hidden", "true");
    $backdrop.removeClass("ac-is-open").attr("aria-hidden", "true");
    $drawer.css({
      transform: "translateX(100%)",
      opacity: "0",
      visibility: "hidden",
      pointerEvents: "none"
    });
    $backdrop.css({
      opacity: "0",
      visibility: "hidden",
      pointerEvents: "none"
    });
    syncBodyDrawerClass();
  }
  function openDrawer($drawer, $backdrop) {
    $drawer.addClass("ac-is-open").attr("aria-hidden", "false");
    $backdrop.addClass("ac-is-open").attr("aria-hidden", "false");
    $drawer.css({
      transform: "translateX(0)",
      opacity: "1",
      visibility: "visible",
      pointerEvents: "auto"
    });
    $backdrop.css({
      opacity: "1",
      visibility: "visible",
      pointerEvents: "auto"
    });
    syncBodyDrawerClass();
  }
  function syncFromCurrentSelection($ui, $form, fabricAttributeName) {
    var fabricSlug = $form.find("select[name='" + fabricAttributeName + "']").val();
    setTriggerState($ui, fabricSlug);
    if (fabricSlug) {
      setSwatchState($("body"), fabricSlug);
    } else {
      $(".ac-fabric-swatch").removeClass("is-active");
    }
  }
  function setTriggerState($ui, fabricSlug) {
    var $selectedText = $ui.find(".ac-fabric-trigger-selected");
    var $thumbWrap = $ui.find(".ac-fabric-trigger-thumb");
    var $thumbImg = $thumbWrap.find("img");
    // Step marker: grey number (matching the accordion) until a fabric is
    // chosen, then a green checkmark — mirrors the .ac-acc-num / .is-done states.
    var $trigger = $ui.find(".ac-fabric-trigger");
    var $num = $ui.find(".ac-fabric-num");
    var baseNum = $num.attr("data-num") || "";
    if (!fabricSlug) {
      $selectedText.text("").removeClass("has-value");
      $thumbWrap.removeClass("has-image");
      $thumbImg.attr("src", "").attr("alt", "");
      $trigger.removeClass("is-selected");
      $num.text(baseNum);
      return;
    }
    $trigger.addClass("is-selected");
    $num.text("✓");
    var $swatch = $(".ac-fabric-swatch[data-fabric-slug='" + fabricSlug + "']").first();
    var swatchName = $.trim($swatch.find(".ac-fabric-swatch-name").first().text()) || fabricSlug.replace(/-/g, " ");
    var thumbSrc = $swatch.find(".ac-fabric-swatch-tile img").first().attr("src") || "";
    $selectedText.text(swatchName).addClass("has-value");
    if (thumbSrc) {
      $thumbImg.attr("src", thumbSrc).attr("alt", swatchName);
      $thumbWrap.addClass("has-image");
    } else {
      $thumbWrap.removeClass("has-image");
      $thumbImg.attr("src", "").attr("alt", "");
    }
  }
  function getSwatchMeta(fabricSlug) {
    var $swatch = $(".ac-fabric-swatch[data-fabric-slug='" + fabricSlug + "']").first();
    return {
      name: $.trim($swatch.find(".ac-fabric-swatch-name").first().text()),
      thumb: $swatch.find(".ac-fabric-swatch-tile img").first().attr("src") || "",
      preview: $swatch.attr("data-preview") || "",
      price: $swatch.attr("data-price") || ""
    };
  }
  function getPreviewImage($form, fabricSlug) {
    if (!fabricSlug) {
      return "";
    }
    var candidate = findBestVariationForFabric($form, fabricSlug);
    if (candidate && candidate.image) {
      return candidate.image.full_src || candidate.image.src || candidate.image.thumb_src || "";
    }
    return "";
  }
  function updateDrawerState($ui, $form, $drawer, fabricSlug) {
    var meta = getSwatchMeta(fabricSlug);
    var preview = meta.preview || getPreviewImage($form, fabricSlug) || meta.thumb;
    var $previewImg = $drawer.find(".ac-fabric-drawer-preview img");
    var $selectedText = $drawer.find(".ac-fabric-drawer-selected");
    var $priceText = $drawer.find(".ac-fabric-drawer-price");
    var $confirmBtn = $drawer.find(".ac-confirm-fabric-selection");
    setSwatchState($("body"), fabricSlug);
    $ui.data("acPendingFabric", fabricSlug || "");
    if (preview) {
      $previewImg.attr("src", preview).attr("alt", meta.name || "Selected fabric");
      $drawer.find(".ac-fabric-drawer-preview").addClass("has-image");
    } else {
      $previewImg.attr("src", "").attr("alt", "");
      $drawer.find(".ac-fabric-drawer-preview").removeClass("has-image");
    }
    $selectedText.text(meta.name || "");
    if (fabricSlug && meta.price) {
      $priceText.html(meta.price).addClass("is-visible");
    } else {
      $priceText.empty().removeClass("is-visible");
    }
    $confirmBtn.prop("disabled", !fabricSlug);
  }
  function applyFabric($ui, $drawer, $backdrop, fabricSlug) {
    var $form = $ui.closest("form.variations_form");
    if (!$form.length) {
      return;
    }
    var fabricAttributeName = $ui.data("fabric-attribute");
    var $fabricSelect = $form.find("select[name='" + fabricAttributeName + "']");
    if (!$fabricSelect.length) {
      return;
    }
    var candidate = findBestVariationForFabric($form, fabricSlug);
    $fabricSelect.val(fabricSlug).trigger("change");
    setVariationFromCandidate($form, candidate);
    setSwatchState($("body"), fabricSlug);
    closeDrawer($drawer, $backdrop);
  }
  function initFabricDrawer($ui) {
    var $form = $ui.closest("form.variations_form");
    if (!$form.length) {
      return;
    }
    var $drawer = $ui.siblings(".ac-fabric-drawer").first();
    var $backdrop = $ui.siblings(".ac-fabric-drawer-backdrop").first();
    if (!$drawer.length || !$backdrop.length) {
      return;
    }
    var $fabricSelect = $form.find("select[name='attribute_pa_fabric']");
    if ($fabricSelect.length) {
      $fabricSelect.closest("tr").hide();
    }
    // The Fabric step sits after the non-fabric accordion steps, so its number
    // is (count of non-fabric attributes) + 1. Stored for setTriggerState.
    var nonFabricCount = $form.find("select[name^='attribute_']").filter(function () {
      return $(this).attr("name") !== "attribute_pa_fabric";
    }).length;
    $ui.find(".ac-fabric-num").attr("data-num", nonFabricCount + 1);
    $ui.find(".ac-open-fabric-drawer").on("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var currentFabric = $form.find("select[name='attribute_pa_fabric']").val() || "";
      openDrawer($drawer, $backdrop);
      updateDrawerState($ui, $form, $drawer, currentFabric);
    });

    // External opener: "Order fabric swatches" button next to Add to Cart.
    $form.on("click", ".ac-order-swatch-trigger", function (event) {
      event.preventDefault();
      var currentFabric = $form.find("select[name='attribute_pa_fabric']").val() || "";
      openDrawer($drawer, $backdrop);
      updateDrawerState($ui, $form, $drawer, currentFabric);
    });
    $backdrop.add($drawer.find(".ac-close-fabric-drawer")).on("click", function () {
      syncFromCurrentSelection($ui, $form, "attribute_pa_fabric");
      closeDrawer($drawer, $backdrop);
    });
    $drawer.on("click", ".ac-fabric-swatch", function () {
      var fabricSlug = $(this).data("fabric-slug");
      if (!fabricSlug) {
        return;
      }
      updateDrawerState($ui, $form, $drawer, fabricSlug);
    });
    $drawer.on("click", ".ac-confirm-fabric-selection", function () {
      var fabricSlug = $ui.data("acPendingFabric") || "";
      if (!fabricSlug) {
        return;
      }
      applyFabric($ui, $drawer, $backdrop, fabricSlug);
    });
    $(document).on("keyup", function (event) {
      if (event.key === "Escape") {
        syncFromCurrentSelection($ui, $form, "attribute_pa_fabric");
        closeDrawer($drawer, $backdrop);
      }
    });
    $form.on("found_variation woocommerce_variation_select_change", function () {
      syncFromCurrentSelection($ui, $form, "attribute_pa_fabric");
    });
    closeDrawer($drawer, $backdrop);
    syncFromCurrentSelection($ui, $form, "attribute_pa_fabric");
  }
  $(function () {
    $(".ac-fabric-swatch-ui").each(function () {
      initFabricDrawer($(this));
    });
  });
})(jQuery);

/* ===== OCTOBER COMMS ADDITION - START =====
   Sample ordering. Wired to the swatch product via admin-ajax (see functions.php).
   ============================================== */
(function ($) {
  "use strict";
  if (typeof acSwatchData === "undefined" || !acSwatchData.hasProduct) {
    return;
  }
  function countLabel(n) {
    return n + (n === 1 ? " swatch" : " swatches") + " selected";
  }
  function initSampleOrdering($drawer) {
    var $count = $drawer.find(".ac-fabric-sample-count");
    var $btn = $drawer.find(".ac-order-swatches");
    var $msg = $drawer.find(".ac-fabric-sample-msg");
    if (!$btn.length) {
      return;
    }
    function selected() {
      return $drawer.find(".ac-fabric-sample-input:checked");
    }
    function refresh() {
      var n = selected().length;
      $count.text(countLabel(n));
      $btn.prop("disabled", n === 0);
      if (n > acSwatchData.freeLimit) {
        $msg.text("Up to " + acSwatchData.freeLimit + " swatches are free. A delivery charge applies beyond that.");
      } else if ($msg.find("a").length === 0) {
        $msg.text("");
      }
    }
    $drawer.on("change", ".ac-fabric-sample-input", refresh);
    $btn.on("click", function () {
      var names = selected().map(function () {
        return $(this).data("fabric-name");
      }).get();
      if (!names.length) {
        return;
      }
      $btn.prop("disabled", true).addClass("is-loading");
      $.post(acSwatchData.ajaxurl, {
        action: "ac_add_fabric_swatches",
        nonce: acSwatchData.nonce,
        swatches: names.join(", ")
      }).done(function (res) {
        if (res && res.success) {
          $msg.html('Swatches added to your basket. <a href="' + acSwatchData.cartUrl + '">View basket</a>');
          selected().prop("checked", false);
          $count.text(countLabel(0));
          $(document.body).trigger("wc_fragment_refresh");
          $(document.body).trigger("added_to_cart");
        } else {
          $msg.text((res && res.data && res.data.message) || "Sorry, that did not work. Please try again.");
        }
      }).fail(function () {
        $msg.text("Sorry, that did not work. Please try again.");
      }).always(function () {
        $btn.removeClass("is-loading").prop("disabled", selected().length === 0);
      });
    }); 
    refresh();
  }
  $(function () {
    $(".ac-fabric-drawer").each(function () {
      initSampleOrdering($(this));
    });
  });
})(jQuery);

/* ===== OCTOBER COMMS ADDITION - END ===== */

/* ===== OCTOBER COMMS ADDITION - START =====
   Variation attributes -> accordion (Size, Cushion Filling, Leg, etc.). Runs on
   fabric-drawer products. Each non-fabric variation <select> becomes a collapsed
   accordion section with the chosen value shown in its header. Picking a value
   sets the native select (so WooCommerce resolves the variation) and auto-opens
   the next unanswered section. The fabric drawer stays as-is, below the
   accordion. One section open at a time.
   ========================================== */
(function ($) {
  "use strict";

  function openNext($list, $current) {
    var $items = $list.find(".ac-acc-item");
    var idx = $items.index($current);
    var $next = null;
    $items.each(function (i) {
      if (i > idx && !$next && !$(this).hasClass("is-done")) {
        $next = $(this);
      }
    });
    if (!$next) {
      $items.each(function () {
        if (!$next && !$(this).hasClass("is-done")) {
          $next = $(this);
        }
      });
    }
    $items.removeClass("is-open");
    if ($next) {
      $next.addClass("is-open");
    }
  }

  function buildItem($form, $select, index, $list) {
    if ($select.data("acAcc")) {
      return false;
    }

    var $row = $select.closest("tr");
    if (!$row.length) {
      $row = $select.parent();
    }
    var label = $.trim($row.find("th, .label").first().text()) || ("Option " + index);

    var $btns = $('<div class="ac-variation-buttons"></div>');
    $select.find("option").each(function () {
      var val = $(this).attr("value");
      if (!val) {
        return; // skip the placeholder
      }
      $('<button type="button" class="ac-variation-btn"></button>')
        .attr("data-value", val)
        .text($(this).text())
        .appendTo($btns);
    });
    if (!$btns.children().length) {
      return false; // nothing to build
    }

    $select.data("acAcc", true);

    var $item = $('<div class="ac-acc-item"></div>').attr("data-attr", $select.attr("name") || "");
    var $header = $(
      '<button type="button" class="ac-acc-header">' +
        '<span class="ac-acc-head-left"><span class="ac-acc-num">' + index + '</span>' +
        '<span class="ac-acc-title"></span></span>' +
        '<span class="ac-acc-chevron">&#9662;</span>' +
      '</button>'
    );
    $header.find(".ac-acc-title").text(label).append(' <span class="ac-acc-sub"></span>');
    var $body = $('<div class="ac-acc-body"></div>').append($btns);
    $item.append($header).append($body);

    // Hide the native dropdown but keep it driving WooCommerce.
    $row.hide();
    $select.next(".select2-container").hide();
    $select.hide();

    $btns.on("click", ".ac-variation-btn", function () {
      $select.val($(this).data("value")).trigger("change");
      $item.addClass("is-done");
      openNext($list, $item);
    });

    function sync() {
      var v = $select.val() || "";
      $btns.find(".ac-variation-btn").removeClass("is-active");
      var $sel = v ? $btns.find(".ac-variation-btn[data-value='" + v + "']") : $();
      $sel.addClass("is-active");
      var chosen = $sel.length ? $.trim($sel.text()) : "";
      $item.find(".ac-acc-sub").text(chosen ? "— " + chosen : "");
      $item.find(".ac-acc-num").text(v ? "✓" : index);
      $item.toggleClass("is-done", !!v);
    }
    $form.on("found_variation woocommerce_variation_select_change reset_data", sync);

    $header.on("click", function (e) {
      e.preventDefault();
      var open = $item.hasClass("is-open");
      $list.find(".ac-acc-item").removeClass("is-open");
      if (!open) {
        $item.addClass("is-open");
      }
    });

    $list.append($item);
    sync();
    return true;
  }

  function initAccordion($form) {
    // Only on fabric-drawer products.
    if (!$(".ac-fabric-swatch-ui").length) {
      return;
    }
    var $list = $('<div class="ac-acc-list"></div>');
    var count = 0;
    $form.find("select[name^='attribute_']").each(function () {
      var name = $(this).attr("name") || "";
      if (name === "attribute_pa_fabric") {
        return; // handled by the drawer
      }
      if (buildItem($form, $(this), count + 1, $list)) {
        count++;
      }
    });
    if (!count) {
      return;
    }

    // Place the accordion where the variations table was; fabric trigger below it.
    var $table = $form.find(".variations").first();
    if ($table.length) {
      $table.before($list);
    } else {
      $form.prepend($list);
    }
    var $ui = $form.find(".ac-fabric-swatch-ui").first();
    if ($ui.length) {
      $list.after($ui);
    }

    // Open the first unanswered section (or the first if all answered).
    var $items = $list.find(".ac-acc-item");
    var $open = null;
    $items.each(function () {
      if (!$open && !$(this).hasClass("is-done")) {
        $open = $(this);
      }
    });
    if (!$open) {
      $open = $items.first();
    }
    $items.removeClass("is-open");
    $open.addClass("is-open");
  }

  $(function () {
    $(".variations_form").each(function () {
      initAccordion($(this));
    });
  });
})(jQuery);
/* ===== OCTOBER COMMS ADDITION - END ===== */

/* ===== OCTOBER COMMS ADDITION - START =====
   Size-aware fabric drawer: when a size is selected, each fabric swatch shows
   that size's single price and render. Falls back to the price range and the
   default preview when no size is chosen yet.
   ========================================== */
(function ($) {
  "use strict";

  function nonFabricSelectName($form) {
    var name = null;
    $form.find("select[name^='attribute_']").each(function () {
      var n = $(this).attr("name");
      if (n && n !== "attribute_pa_fabric" && !name) {
        name = n;
      }
    });
    return name;
  }

  function refresh($form) {
    if (typeof acSwatchData === "undefined") {
      return;
    }
    var matrix = acSwatchData.matrix || {};
    // Composite key of every non-fabric attribute selection, sorted by name,
    // joined with "|" — must match the PHP key exactly.
    var pairs = [];
    $form.find("select[name^='attribute_']").each(function () {
      var name = $(this).attr("name");
      if (!name || name === "attribute_pa_fabric") {
        return;
      }
      var val = $(this).val() || "";
      if (!val) {
        return;
      }
      pairs.push(name + "=" + val);
    });
    pairs.sort();
    var compo = pairs.join("|");
    var sizeMap = (compo && matrix[compo]) ? matrix[compo] : null;

    $(".ac-fabric-swatch").each(function () {
      var $sw = $(this);
      var fabric = $sw.attr("data-fabric-slug");

      var $tileImg = $sw.find(".ac-fabric-swatch-tile img").first();

      // Remember the server-rendered range, preview and tile once.
      if ($sw.data("acBasePrice") === undefined) {
        $sw.data("acBasePrice", $sw.attr("data-price") || "");
        $sw.data("acBasePreview", $sw.attr("data-preview") || "");
        $sw.data("acBaseTile", $tileImg.attr("src") || "");
      }

      var entry = sizeMap ? sizeMap[fabric] : null;
      if (entry && entry.preview) {
        if (entry.price) {
          $sw.attr("data-price", entry.price);
        }
        $sw.attr("data-preview", entry.preview);
        $tileImg.attr("src", entry.preview); // tile matches the selected size
      } else if (entry) {
        // Variation exists but no size-specific image: update price, keep base tile/preview.
        if (entry.price) {
          $sw.attr("data-price", entry.price);
        }
        $sw.attr("data-preview", $sw.data("acBasePreview"));
        $tileImg.attr("src", $sw.data("acBaseTile"));
      } else {
        // No size chosen: show the default range, preview and tile.
        $sw.attr("data-price", $sw.data("acBasePrice"));
        $sw.attr("data-preview", $sw.data("acBasePreview"));
        $tileImg.attr("src", $sw.data("acBaseTile"));
      }
    });
  }

  $(function () {
    $(".variations_form").each(function () {
      var $form = $(this);
      if (!$(".ac-fabric-swatch-ui").length) {
        return;
      }
      $form.on("found_variation woocommerce_variation_select_change reset_data", function () {
        refresh($form);
      });
      refresh($form);
    });
  });
})(jQuery);
/* ===== OCTOBER COMMS ADDITION - END ===== */

/* ===== OCTOBER COMMS ADDITION - START =====
   Customise modal: opens the Gravity Form rendered in the trust bullets.
   ========================================== */
(function ($) {
  "use strict";
  $(function () {
    var $overlay = $("#ac-customise-modal");
    if (!$overlay.length) {
      return;
    }
    // Move to <body> so the sticky nav / page builder stacking can't trap it.
    $overlay.appendTo(document.body);
    function open(e) {
      if (e) { e.preventDefault(); }
      $overlay.addClass("is-open").attr("aria-hidden", "false");
      $("body").addClass("ac-modal-open");
    }
    function close() {
      $overlay.removeClass("is-open").attr("aria-hidden", "true");
      $("body").removeClass("ac-modal-open");
    }
    $(document).on("click", ".ac-open-customise", open);
    $overlay.on("click", function (e) { if (e.target === this) { close(); } });
    $overlay.on("click", ".ac-modal-close", close);
    $(document).on("keyup", function (e) { if (e.key === "Escape") { close(); } });
  });
})(jQuery);
/* ===== OCTOBER COMMS ADDITION - END ===== */