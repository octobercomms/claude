function lsbasketajax(){
  var price = jQuery('.order-total .amount').first().text();

  jQuery.ajax({
     url: ls_custom_obj.ajaxurl, // or example_ajax_obj.ajaxurl if using on frontend
     data: {
         'action': 'ajax_show_currency',
         'price' : price
     },
     success:function(data) {
         // This outputs the result of the ajax request
         jQuery('tr.order-total td').append(data);
     }
 });

}

function resizeFunction() {
		// Stuff that should happen on resize

		var repsonsivehelper = jQuery('.responsive-helper').css('width');

    //var cartquestionswrap = jQuery('.cart-questions-wrap');

	 if(repsonsivehelper =='1px' || repsonsivehelper =='2px' ){ //1024 or 768

    //  jQuery(cartquestionswrap).appendTo('.cart-collaterals');

    }else if(repsonsivehelper =='0'){//reset

   //   jQuery(cartquestionswrap).prependTo('.heal-wrap');
		}

};



jQuery(document).ready(function($) {


  $('.variations td.value').each(function () {
    if ($(this).find('.cfvsw-swatches-container').length) {
      $(this).addClass('has-swatches');
    }
  });



  //remove proceed to chekout for us customers
  if ($('body').hasClass('US_user')) {
         $('.wc-proceed-to-checkout').remove();
         $('.woocommerce-shipping-totals').remove();

     }

     $('.toggle-quote-form').click(function(){

      $('.us-shipping-quote-box').slideDown();
     });


  $('.clerance-enquire').on('click', function(e){
      e.preventDefault();

      // Get product from data attribute
      var product = $(this).data('product');

      // Pre-populate GF field
      $('#input_13_6').val(product);

      // Fade in the popup (change selector if needed)
      $('#clerance-form').fadeIn(300);
    });


  $('.clearance-form-close').on('click', function(e){
      $('#clerance-form').fadeOut(300);
  });





  $('#cat-read-more-toggle').click(function(e){
    e.preventDefault();

    $('#cat-more-text').slideToggle();
  });


  /***Product Cat Filters****/




  jQuery(function($) {
      // Toggle filter dropdown visibility when clicking on a filter header
      $('.custom-filters > li span').on('click', function(e) {
          e.stopPropagation(); // Prevent the click from propagating to the document

          var targetGroup = $(this).closest('li').find('.filter-group'); // Find the .filter-group inside the clicked <li>

          // If the target group is already visible, slide it up (hide it)
          if (targetGroup.is(':visible')) {
              targetGroup.stop(true, true).slideUp(200);
          } else {
              // Slide up all other filter groups
              $('.filter-group').slideUp(200);

              // Slide down the target .filter-group
              targetGroup.stop(true, true).slideDown(200);
          }
      });

      // Close all filter groups if the user clicks anywhere else on the screen
      $(document).on('click', function(e) {
          // If the click is outside the filter dropdown, close all filter groups
          if (!$(e.target).closest('.custom-filters').length) {
              $('.filter-group').slideUp(200); // Close all filter groups
          }
      });

      // Prevent the event from propagating to the document when clicking inside the .custom-filters
      $('.custom-filters').on('click', function(e) {
          e.stopPropagation();
      });
  });


  /***Filter AJAX***/

  jQuery(function($) {



      // Access the original query params passed from PHP
      var originalQueryParams = window.ls_custom_obj;



      //Price Slider

      // Access the min and max prices directly from the slider element's data attributes
      var min_price = $('#price_range_slider').data('min-price');
      var max_price = $('#price_range_slider').data('max-price');

      var slider = document.getElementById('price_range_slider');

      if (slider) {
        // avoid double initialisation if this code can run more than once
        if (!slider.noUiSlider) {
          noUiSlider.create(slider, {
            start: [min_price, max_price],
            connect: true,
            range: { min: min_price, max: max_price },
            step: 1,
            pips: { mode: 'steps', stepped: true, density: 10 }
          });
        }

        // Update the labels when the slider changes
        slider.noUiSlider.on('update', function(values) {
          $('#min_price_value').text(Math.floor(values[0]));
          $('#max_price_value').text(Math.floor(values[1]));
        });

        // Trigger AJAX when the slider value changes
        slider.noUiSlider.on('change', function() {
          var filters = collectFilters();
          applyFilters(filters);
        });
      }
      // else: element not present → do nothing




      // Function to collect the user-selected filters and apply them
      function collectFilters() {
          var filters = {
              'original_products': ls_custom_obj.product_ids, // Original products
              'orderby': originalQueryParams.orderby, // Default to original order
              'order': originalQueryParams.order, // Default to original order direction
              'meta_query': originalQueryParams.meta_query || [], // Preserve original meta query, if any
              'tax_query': originalQueryParams.tax_query || [], // Preserve original tax query, if any
              'posts_per_page': originalQueryParams.posts_per_page, // Default number of posts per page
              'paged': originalQueryParams.paged, // Keep the current page
              's': originalQueryParams.s // Preserve search query, if any
          };

          // Check if all filters are unchecked and price slider is not in use
          var allFiltersUnchecked = !$('.filter-size:checked').length &&
                                    !$('.filter-finish:checked').length &&
                                    !$('.filter-shape:checked').length &&
                                    !$('.filter-material:checked').length &&
                                    !$('.filter-extendable:checked').length &&
                                    !$('#price_range_slider').val().length;

          if (allFiltersUnchecked || $('.all').is(':checked')) {
              filters.showall = true; // Flag to indicate "show all products"
          }else{
           filters.showall = false;
          }


          // Collect user-selected filters (e.g., size, finish, shape, extendable)
          filters.size = [];
          filters.finish = [];
          filters.material = [];
          filters.shape = [];
          filters.extendable = [];

          // Check if user selected any filters (checkboxes)
          $('.filter-size:checked').each(function() {
              filters.size.push($(this).data('term-id'));
          });
          $('.filter-finish:checked').each(function() {
              filters.finish.push($(this).data('term-id'));
          });
          $('.filter-shape:checked').each(function() {
              filters.shape.push($(this).data('term-id'));
          });
          $('.filter-material:checked').each(function() {
              filters.material.push($(this).data('term-id'));
          });
          $('.filter-extendable:checked').each(function() {
              filters.extendable.push($(this).data('term-id'));
          });

          // Get the current price range from the price slider
            // Get the current price range from the price slider
            var priceValues = slider.noUiSlider.get(); // Use noUiSlider's get method
            if (priceValues) {
                filters.min_price = priceValues[0];
                filters.max_price = priceValues[1];
            }

              console.log(priceValues);

          // Ensure category filter is set (from the category data attribute)
          filters['category'] = $('.custom-filters').data('category-id');

          return filters;
      }

      // Pagination state for the filtered results (Load more).
      var lsCurrentFilters = null;
      var lsCurrentPage    = 1;
      var lsMaxPages       = 1;

      // Apply filters and make the AJAX request.
      //   page   – which page to fetch (defaults to 1)
      //   append – true to add the results below the current ones ("Load more"),
      //            false/omitted to replace the grid (a fresh filter change).
     function applyFilters(filters, page, append) {
         page   = page || 1;
         append = append || false;

         // Remember the active filter set + page so "Load more" can fetch the next.
         lsCurrentFilters = filters;
         lsCurrentPage    = page;

         // Ask the server for one page at a time. per_page mirrors the shop
         // archive (the server clamps it). Sending `page` is what switches the
         // handler into fast paged mode; older handlers simply ignore it and
         // return everything, so this stays safe either way.
         filters.page     = page;
         filters.per_page = parseInt(ls_custom_obj.posts_per_page, 10) || 45;

         if (append) {
             // Keep the grid; just show the button is working.
             $('.ls-filter-load-more').addClass('loading').text('Loading…');
         } else {
             // Fresh filter change → show loading placeholders and reset to page 1.
             $('.products').html('<div class="product-placeholder"></div><div class="product-placeholder"></div><div class="product-placeholder"></div>');
         }

         // Make the AJAX request to fetch the filtered products
         $.ajax({
             url: ls_custom_obj.ajaxurl, // Use the localized AJAX URL
             method: 'GET',
             data: {
                 action: 'filter_products',  // Custom action
                 nonce: ls_custom_obj.nonce, // Use the localized nonce for security
                 filters: filters
             },
             success: function(response) {
                 if (response.success) {
                     if (append) {
                         $('.products').append(response.data.products); // Add the next page
                     } else {
                         $('.products').html(response.data.products);   // Replace with page 1
                     }
                     // How many pages exist for this filter set. Older handlers
                     // don't send this → treated as a single page (no button).
                     lsMaxPages = parseInt(response.data.max_num_pages, 10) || 1;
                     updateLoadMore();
                 } else {
                     console.error('No products returned');
                     $('.products').html('<p>No products found.</p>');
                     updateLoadMore();
                 }
             },
            error: function(xhr, status, error) {
                   console.error('AJAX Error:', error); // Log the error message
                   console.log('XHR Status:', status); // Log the status
                   console.log('XHR Response Text:', xhr.responseText); // Log the raw response text
               }
         });

         console.log('Applying filters:', filters);  // See the filters being sent

     }

      // Show / hide the filtered "Load more" button based on the page count.
      function updateLoadMore() {
          $('.ls-filter-load-more-wrap').remove();
          // Hide the theme's native load-more while a filtered set is shown so the
          // two paginations don't fight (harmless no-op if it isn't present).
          $('.getbowtied_ajax_load_button, .getbowtied_ajax_load_more').hide();
          if (lsCurrentPage < lsMaxPages) {
              $('.products').after('<div class="ls-filter-load-more-wrap" style="clear:both;width:100%;text-align:center;margin:2em 0;"><a href="#" class="ls-filter-load-more button">Load more</a></div>');
          }
      }

      // "Load more" → fetch the next page and append it.
      $(document).on('click', '.ls-filter-load-more', function(e) {
          e.preventDefault();
          if (lsCurrentFilters && lsCurrentPage < lsMaxPages) {
              applyFilters(lsCurrentFilters, lsCurrentPage + 1, true);
          }
      });



      // Trigger the filter when the checkbox filters change
      $('.custom-filters input').on('change', function() {
          var filters = collectFilters();
          applyFilters(filters);
      });

      // Trigger the filter when the price slider changes
      $('#price_range_slider').off('change').on('change', function() {
          var filters = collectFilters();
          applyFilters(filters);
      });

      // Reset all filters when "All" is clicked and refresh the page
     $('.all').on('click', function() {
         // Reset all checkboxes to unchecked
         $('.custom-filters input').prop('checked', false);

         // Reset the price slider to its default values (min_price and max_price)
         $('#min_price').val(min_price);
         $('#max_price').val(max_price);
         $('#min_price_value').text(min_price);
         $('#max_price_value').text(max_price);

         // Reset the price slider to its default range
         slider.noUiSlider.set([min_price, max_price]); // Reset the slider to the original range

         // Trigger the filter to refresh with no filters applied
         var filters = collectFilters();
         applyFilters(filters);
     });




  });

// Mobile filter toggle click handler
$('.mobile-filter-toggle, .mobile-filter-toggle span').on('click', function() {
    var $this = $(this).closest('.mobile-filter-toggle'); // Ensure we are targeting the parent .mobile-filter-toggle

    // Toggle the 'active' class on the clicked button
    $this.toggleClass('active');

    // Change the text inside the span from "+" to "-" and vice versa
    var $span = $this.find('span');
    if ($this.hasClass('active')) {
        $span.text('-'); // Set text to "-" when active
        $('.custom-filters > li:not(.mobile-filter-toggle)').slideDown(); // Show the filter list
    } else {
        $span.text('+'); // Set text to "+" when inactive
        $('.custom-filters > li:not(.mobile-filter-toggle)').slideUp(); // Hide the filter list
    }
});


/***End Cat Filters ****/


  $('#reserve-toggle').click(function(){
    $('.reserve-popup').fadeIn();
    $(this).hide();
  });


  $('.book-visit').click(function(){
    $('#calendly-popup').slideDown();
  });

  $('#calendly-popup .close').click(function(){
    $('#calendly-popup').slideUp();
  });

  $('.retail-swatch-row .wpb_text_column').click(function(){
    var link= $(this).find('h3 a').attr('href');
    window.location.href = link;
  });


  $('.heal-wrap .read-more').click(function(){
    $(this).hide();
    $('.heal-wrap .read-more-wrap').slideDown();
  });


//Download filter
  $('#download-filter').bind('change', function(){
    var cat=$(this).val();
      var params = [
          "cat="+cat,
      ];


      window.location.href = window.location.protocol + "//" + window.location.host + window.location.pathname + '?' + params.join('&');

  });



  if($('.discover-more-lookbook-col').length){
    var lookbookurl = $('.discover-more-lookbook-col').find('a').attr('href');

    $('.discover-more-lookbook-col').click(function(){
      window.location.href = lookbookurl;
    })
  }

  $('.tools .currency').click(function(){
    $(this).find('.currency-list').slideToggle();
  });

  $('.currency-list li').click(function(){
    if($(this).hasClass('active')){}else{
      var currency= $(this).attr('id');
      document.cookie = "aelia_cs_selected_currency="+currency;
      location.reload();

    };
  });


  //Lookbook Slider

  if ($(window).outerWidth() >= 768) {

    $('.lookbook-slide.text-image').each(function(){
      if( ($(this).hasClass('caption-left') && $(this).hasClass('heading-left')) || ($(this).hasClass('caption-right') && $(this).hasClass('heading-right')) ){
        var heading=$(this).find('.heading');
        $(this).find('p.caption').appendTo(heading);
      }

    });

  }


  $lookbook_slider=$('#lookbook');

    var lookbook_settings={
    dots: false,
    infinite: false,
    speed: 500,
    cssEase: 'linear',
    centerMode: true,
    variableWidth: true,
      centerPadding: '500px',
      slidesToShow: 2,
    arrows: true,
    autoplay: false,
    prevArrow:"<button type='button' class='ls-slick-prev'><span class='ls-prev'></span></button>",
    nextArrow:"<button type='button' class='ls-slick-next'><span class='ls-next'></span></button>"
  }

  //$lookbook_slider.slick(lookbook_settings);

  if ($(window).outerWidth() < 768) {
    if ($lookbook_slider.hasClass('slick-initialized')) {
      $lookbook_slider.slick('unslick');
    }
  }else{
    $lookbook_slider.slick(lookbook_settings);
  }



  $(window).on('resize', function() {
     if ($(window).outerWidth() < 768) {
       if ($lookbook_slider.hasClass('slick-initialized')) {
         $lookbook_slider.slick('unslick');
       }
     }else{
        $lookbook_slider.slick(lookbook_settings);
     }
   });


  $('.first-slide-arrow').click( function () {
    $lookbook_slider.slick('slickGoTo', 1);

  });


  $lookbook_slider.on('afterChange', function(event, slick, currentSlide, nextSlide){
    if(currentSlide > 0){
      $('.ls-prev, .ls-next').animate({opacity: 1}, 1000);
    }else{
      $('.ls-prev, .ls-next').animate({opacity: 0}, 1000);
    }
  });



//Remove the title attr from images so they don't show on hover
  $('img').removeAttr('title');


  $('body').on('updated_checkout', function(){
    if ($(".choose-payment-label")[0]){}else{
      $('#payment').prepend('<h4 class="choose-payment-label">Choose Payment Method:</h4>');

    }
      $(".payment_method_klarna_payments_pay_later, .payment_method_klarna_payments_pay_over_time").wrapAll("<li class='wc_payment_method klarna_wrap'></li>");

  });

  $('#payment').prepend('<h4 class="choose-payment-label">Choose Payment Method:</h4>');
  $(".payment_method_klarna_payments_pay_later, .payment_method_klarna_payments_pay_over_time").wrapAll("<li class='wc_payment_method klarna_wrap'></li>");


  $('.shipping_address').prepend('<h3>Delivery Details</h3>');

  $('#drst-toggle').click(function(){
    $('#ldn-toggle').removeClass('active');
    $(this).addClass('active');

    $('#london').hide();
    $('#dorset').fadeIn();
  });
  $('#ldn-toggle').click(function(){
    $('#drst-toggle').removeClass('active');
    $(this).addClass('active');

    $('#dorset').hide();
    $('#london').fadeIn();
  });


    //hide stock element if empty on product page

    var stockel = $('body.single-product .woo-custom-stock-status').text();
    if (!stockel.replace(/\s/g, '').length) {
      $('body.single-product .woo-custom-stock-status').hide();
    }

     /*$('body.single-product #dimensions').find('.wpb_wrapper').each(function(){
      var dimenCol =$(this).html();
      if (!dimenCol.replace(/\s/g, '').length) {
        $(this).closest('.wpb_column').hide();
      }
     });*/

    //hide dimensions columns if empty

    $('body.single-product #dimensions').find('.wpb_column').each(function(){

      if($(this).find(".wpb_text_column").length < 1 && $(this).find(".wpb_single_image").length < 1){
        $(this).hide();
      }
    });


    //move the price on variable products
    if($('.single_variation_wrap').length){
      $('.product_price').insertBefore('.woocommerce-variation-add-to-cart');
    }

    setTimeout(function() {
      $('.getbowtied_ajax_load_button a').html('Load more');
  }, 500);


               // Initialize Slick Slider
               $('#product_single_image_slider').slick({
                 dots: false,
                 infinite: true,
                 speed: 500,
                 fade: true,
                 cssEase: 'linear',
                 arrows: true,
                 autoplay: false,
                 prevArrow: "<button type='button' class='ls-slick-prev'><span class='ls-prev'></span></button>",
                 nextArrow: "<button type='button' class='ls-slick-next'><span class='ls-next'></span></button>"
               });

               //console.log('%c[Slider Init]','color:limegreen', 'Slick slider initialized for #product_single_image_slider');

               // Listen for variation change
               $('form.variations_form').on('woocommerce_variation_select_change', function() {
                // console.log('%c[Variation Event]','color:deepskyblue', 'Variation selection changed...');

                 setTimeout(function() {
                   // Get selected variation ID
                   var selectedVariationId = $('input.variation_id').val();
                //   console.log('%c[Variation ID]','color:orange', 'Selected variation ID:', selectedVariationId);

                   if (!selectedVariationId) {
                  //   console.warn('[Variation Debug] No variation ID detected.');
                     return;
                   }

                   // Check if slider exists
                   if (!$('#product_single_image_slider').length) {
                  //   console.warn('[Variation Debug] Slider element not found.');
                     return;
                   }

                   // Get all variation images in the slider
                   var $variationImgs = $('#product_single_image_slider img[data-variation-id]').not('.slick-cloned');
                  // console.log('[Variation Debug] Found', $variationImgs.length, 'variation image(s) in the slider.');

                   var foundMatch = false;

                   $variationImgs.each(function(index) {
                     var $img = $(this);
                     var variationIds = $img.data('variation-id');

                   //  console.log('[Variation Debug] → Checking image #' + index, 'data-variation-id:', variationIds);

                     if (!variationIds) return; // skip if no data attribute

                     // Normalize IDs
                     var variationArray = (typeof variationIds === 'string')
                       ? variationIds.split(',').map(id => id.trim())
                       : [String(variationIds)];

                     // Check for match
                     if (variationArray.includes(selectedVariationId)) {
                       var slideIndex = $img.closest('.slick-slide').data('slick-index');
                     //  console.log('%c[Match Found]','color:limegreen', 'Image #' + index, 'matches variation', selectedVariationId, '| Slide index:', slideIndex);

                       if (typeof slideIndex !== 'undefined') {
                         $('#product_single_image_slider').slick('slickGoTo', slideIndex);
                     //    console.log('%c[Slider Action]','color:gold', 'Jumped to slide index', slideIndex);
                       } else {
                      //   console.warn('[Variation Debug] Slide index undefined for matched image.');
                       }

                       foundMatch = true;
                       return false; // break loop
                     }
                   });

                   if (!foundMatch) {
                  //   console.warn('[Variation Debug] No matching image found for variation:', selectedVariationId);
                   }

                 }, 100); // Small delay to ensure WooCommerce updates variation
               });





      $('#product_single_image_slider img').on('click', function(){
        $('.row_split, .first_col_split').toggleClass("zoomed");


      });


        $('#home-slider .wpb_wrapper').slick({
        dots: false,
        infinite: true,
        speed: 500,
        fade: true,
        cssEase: 'linear',
        arrows: true,
        autoplay: false,
        prevArrow:"<button type='button' class='ls-slick-prev'><span class='ls-prev'></span></button>",
        nextArrow:"<button type='button' class='ls-slick-next'><span class='ls-next'></span></button>"
      });


      $('#header-banner-slider').slick({
      dots: false,
      infinite: true,
      speed: 500,
      fade: true,
      cssEase: 'linear',
      arrows: false,
      autoplay: true,
      autoplaySpeed: 15000,
    });



  $('.us-popup-wrap  .inner a').click(function(){
    $('.us-popup-wrap').hide();
    Cookies.set('geo-popup-close', 'true', { expires: 30 });
  });

  //hide the out of stock email notifier box on variable products on page load.
  $('.product-type-variable .alert_container').hide();


      	 var offset = 800;
          var speed = 250;
          var duration = 500;
          $(window).scroll(function(){
              if ($(this).scrollTop() < offset) {
                        $('.topbutton') .fadeOut(duration);
              } else {
                        $('.topbutton') .fadeIn(duration);
              }
          });
            $('.topbutton').on('click', function(){
              $('html, body').animate({scrollTop:0}, speed);
              return false;
            });

	var bannerback = $('.header-banner').attr('data-bg');

	if(bannerback !=''){
	$('.header-banner').css({"background-color":bannerback});
	}

  $('.heal-checkbox').on('change', function(){
    //uncheck other checkbox
    $('.heal-checkbox').not(this).attr('checked', false);

		var healtype =$(this).attr('id');

		if ($(this).is(':checked')) {
    var checkval =1;
		}else{
			var checkval =0;
		}

		jQuery.ajax({
			 url: ls_custom_obj.ajaxurl, // or example_ajax_obj.ajaxurl if using on frontend
			 data: {
					 'action': 'ajax_heals',
					 'checkval' : checkval,
           'healtype' : healtype,
			 },
			 	type : 'POST',
			 success:function(data) {
					 // This outputs the result of the ajax request
					 //jQuery('tr.order-total td').append(data);
					 //$( '.entry-content' ).html(data);
					 //console.log('success');
					 location.reload();


			 }
	 });



  });



	resizeFunction();

	$(window).on('resize', function(){
		//resizeFunction();

    $('#product_single_image_slider').slick('resize');


	});

  $('.header-banner').click(function(){

    window.location=$(this).data("link");
  });



	$('#enquiry').click(function(){
		$('.form-popup').fadeIn();
	});



	$(document).on('click','.closeit',function(){
		$(this).closest('.form-popup').fadeOut();
	});


	//Trade product swatches
	//$('.swatch').append('<span class="titletag">Black Ash</span>')

			$('.swatch').hover(function(e){
			title = $(this).attr('data-name');
			$(this).append('<span class="titletag">'+title+'</span>')
		},
		function(e){
			$('span.titletag', this).remove();
		});

	$('.swatch-wrap .swatch').click(function(){
		$('.swatchpopup').hide();
		var $id=$(this).attr('data-swatch');
		$('.swatchpopup[data-swatch="'+$id+'"]').fadeIn();

	});

	$('.swatch-wrap .swatchpopup').click(function(){
		$(this).fadeOut();
	});




  ///TRADE PRODUICTS SLIDERS

  if ($(".single-trade_collection .row_split .product-images-carousel").length) {
		var product_images = new Swiper ('.row_split .product-images-carousel', {
			//grabCursor: true,
			preventClicks: true,
			preventClicksPropagation: true,
			autoHeight: true,
			preloadImages: true,
			updateOnImagesReady: true,
	        lazyLoading: true,
	        nextButton: '.swiper-button-next',
	        prevButton: '.swiper-button-prev',
		});

  }

		if ($(".single-trade_collection .row_split .product-thumbnails-carousel").length) {

			var product_thumbnails_vertical = new Swiper ('.product-thumbnails-vertical-wrapper .product-thumbnails-carousel', {
		        direction: 'vertical',
		        slidesPerView: 4,
		        preventClicks: false,
		        preventClicksPropagation: false
			});

    }

		function activate_slide_ls(index) {

				product_images.slideTo(index, 300, false);

				if ($(".row_split .product-thumbnails-carousel").length) {

					product_thumbnails_vertical.slideTo(index-1, 300, false);

					$(".product-thumbnails-vertical-wrapper .swiper-slide").removeClass("active").eq(index).addClass("active");

				}

				if (index == 0) {
					temp_img_html = $(".row_split .product-images-carousel .swiper-slide").eq(0).find(".images").html();
				} else {
					temp_img_html = $(".row_split .product-images-carousel .swiper-slide").eq(index).html();
				}

				$(".product-image-temp").html(temp_img_html);

			}

    if ($(".single-trade_collection .row_split .product-thumbnails-carousel").length) {

    //  $(".product-thumbnails-vertical-wrapper .swiper-slide").eq(0).addClass("active");
		//	$(".product-thumbnails-horizontal-wrapper .swiper-slide").eq(0).addClass("active");

            product_images.on('SlideChangeStart', function() {
      				activate_slide_ls(product_images.activeIndex);
      			});

  				if ($('.product-thumbnails-vertical-wrapper .product-thumbnails-carousel').length) {
  					product_thumbnails_vertical.on('onTap', function() {
  						activate_slide_ls(product_thumbnails_vertical.clickedIndex);
  					});
  				}

        }



  var lsgallerytop = new Swiper('.trade-gallery', {
//spaceBetween: 10,
  //  loop:true,
  //  loopedSlides: 2, //looped slides should be the same
    thumbs: {
      swiper: lsgallerythumbs,
    },
  });

  var lsgallerythumbs = new Swiper('.trade-gallery-thumbs', {
        //spaceBetween: 10,
        slidesPerView: 2,
      //  freeMode: true,
        //loopedSlides: 2, //looped slides should be the same
      //  watchSlidesVisibility: true,
      //  watchSlidesProgress: true,

      });






//Force instagram grid to load correct size images.

  var homesqHeight = $('.insta-helper .home-square').height();

  var instatileHeight = homesqHeight/2;

  $('.sbi_photo ').each(function(){
    $(this).css({"height":instatileHeight});
  });

  var string = $('body.single-product .in-stock').text();
  string=string.replace(/\d+/g, '');
  $('body.single-product .in-stock').text(string);


var breadcount=1;
$('#breadcrumbs a').each(function(){
if(breadcount > 1){
  $(this).prepend(' > ');
}
breadcount=breadcount+1

});

  var pricecount=$('.product_price .price .amount').length;

  if(pricecount > 1){
    $('.exchange').hide();
  }

//Add the currency to variable products
 /* $( ".single_variation_wrap" ).on( "show_variation", function ( event, variation ) {


    //$('body.product_cat_lighting.single-product').find('p.available-on-backorder').text('Two week lead time');

    var price = $('.woocommerce-variation-price .amount').last().text();

    $.ajax({
       url: ls_custom_obj.ajaxurl, // or example_ajax_obj.ajaxurl if using on frontend
       data: {
           'action': 'ajax_show_currency',
           'price' : price
       },
       success:function(data) {
           // This outputs the result of the ajax request
           $('.woocommerce-variation-price .amount').append(data);
       }
   });

  } );*/

  //Add price to basket total

  if ($('.woocommerce-cart .order-total .amount').length > 0){
    lsbasketajax();
  }
    $( document.body ).on( 'updated_cart_totals', function(){
      lsbasketajax();
    } );





  $('.home-square').each(function(){

    var url = $(this).find('a').attr('href');


    $(this).find('h2').wrapInner('<a href="' + url +'"></a>');

  });


    //SMooth Scroll to anchor
  /*  $(document).on('click', 'a[href^="#"]', function (event) {
        event.preventDefault();

        $('html, body').animate({
            scrollTop: $($.attr(this, 'href')).offset().top -100
        }, 500);
    });*/

    /***
    SINGLE PRODUCT
    ****/

    $('#swatches').select2({
    	placeholder: 'Select Swatches',
    	templateResult: swatchDisplay,
    	templateSelection: swatchDisplay,
      maximumSelectionLength: 5,
    });

    function swatchDisplay (opt) {
        var optimage = $(opt.element).attr('data-image');

            var $opt = $(
               '<span><img src="'+optimage+'" width="60px" /> ' + opt.text + '</span>'
            );
            return $opt;

    };//swatchDisplay

    $('.multiselect').on('change.select2', function (e) {

      var swatches=[];

      $('#swatches').find(':selected').each(function(){
        swatches.push($(this).data('label'));
      });
      swatches.join();
      $('#swatches_hidden_input').val(swatches);

    });





    $( ".single_variation_wrap" ).on( "show_variation", function ( event, variation ) {
        // Fired when the user selects all the required dropdowns / attributes
        // and a final variation is selected / shown
         $(".woocommerce-variation-price .stock").remove();
         $("body.single-product .stock").appendTo(".woocommerce-variation-price .amount");
        $('body.single-product .alert_container').prependTo('.afterform-wrap');
        $('body.single-product .single_variation_wrap .in-stock').text('In stock');


        if($('.woocommerce-variation-price > .price').length){
          $('.product_price').hide();
        }

        $('body.single-product p.stock.in-stock').not(':last').remove();

    } );

    $( ".single_variation_wrap" ).on( "hide_variation", function ( event, variation ) {
        $('body.single-product .woocommerce-variation-price .amount .stock').remove();
    });

    $('.credential-icon-wrap img').hover(function(){
        var text=$(this).attr('alt');
        $('.credential-icon-wrap .caption-box').text(text);
        $('.credential-icon-wrap .caption-box').toggleClass("show");
    });

    if($('.credential').length || $('.delivery-info-link').length){
      $(document).on('click',function(e) {

        /*Credentials*/
         if($(e.target).hasClass('credential')){
           var target=$(e.target).find('.credential-textbox');
           $('.credential-textbox').not(target).removeClass("show");
           target.toggleClass("show");
           $('.delivery-info-dropdown').hide();
         } else if ($(e.target).hasClass('cred-im')){
           var target= $(e.target).closest('.credential').find('.credential-textbox');
           $('.credential-textbox').not(target).removeClass("show");
          target.toggleClass("show");
          $('.delivery-info-dropdown').hide();

          /*Delivery info link*/
        }else if($(e.target).hasClass('delivery-info-link')){
          e.preventDefault();
          $('.delivery-info-dropdown').toggle();
          $('.credential-textbox').removeClass("show");
        }

        /*Anywhere else*/
        else{
           $('.credential-textbox').removeClass("show");
           $('.delivery-info-dropdown').hide();
         }




      });


    }//credential has length

/*
    $('.credential-icon-wrap_ver2 .credential').click(function(){
    });
*/


/*
    $('.delivery-info-link').click(function(e){
      e.preventDefault();
      $('.delivery-info-dropdown').toggle();
    });
*/


    $('body.single-product .stock').appendTo('.woocommerce-variation-price .amount');


    $(':not(.menu-button) + .menu-button, * > .menu-button:first-of-type').
    each(function() {
        $(this).
        nextUntil(':not(.menu-button)').
        addBack().
        wrapAll('<div class="menu-button-wrapper" />');
    });

    $('.myaccount-popup .woocommerce-notices-wrapper').each(function() {
        $(this).insertBefore($(this).closest('.myaccount-popup'));
    })

    $(window).scroll(function() { // Click to Link
        if ($(document).scrollTop() > 100) {
            $('.site-header-mobiles').addClass('scrolling');

        }
        else {
            $('.site-header-mobiles').removeClass('scrolling');

        }
    });

    //international shippibng quote form

  /*  $('body').on('country_to_state_changed', function(){
    update_shipping_calc_form();
    var shipcountry =jQuery('#calc_shipping_country').val();
    console.log('t'+shipcountry);

    if(shipcountry !='GB'){
      console.log('2'+shipcountry);
      setTimeout(function() {
      $('.shipping_form_wrap').show();
    }, 2000);

    }else{
      console.log('3'+shipcountry);

      $('.shipping_form_wrap').hide();
    }
  });*/

    setTimeout(function() {
      update_shipping_calc_form();
      update_shipping_calc_form_checkout();

    }, 2000);

    $('body').on('updated_wc_div', function(){
      update_shipping_calc_form();
      });

    $('body').on('updated_checkout', function(){
        update_shipping_calc_form_checkout();
    });


});// doc ready

function update_shipping_calc_form_checkout(){
    jQuery('.shipping_form_wrap').appendTo('.checkout-col-aside');

  if(jQuery('#ship-to-different-address-checkbox').is(':checked')) {
    var country = jQuery('#shipping_country').find(":selected").val();
    var shippcode =jQuery('#shipping_postcode').val();
    var shiptown =jQuery('#shipping_city').val();
    var shipcounty =jQuery('#shipping_state').val();
  }else{
    var country = jQuery('#billing_country').find(":selected").val();
    var shippcode =jQuery('#billing_postcode').val();
    var shiptown =jQuery('#billing_city').val();
    var shipcounty =jQuery('#billing_state').val();
  }


  var products_string='';
    jQuery('.woocommerce-checkout-review-order-table .cart_item').each(function(){
      products_string = products_string + jQuery(this).find('.product-name').text() +': '+ jQuery(this).find('.woocommerce-Price-amount bdi').text() +', ';
    });


    var eu_Countries = [
            'AL', 'AD', 'AM', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE',
            'DK', 'EE', 'ES', 'FO', 'FI', 'FR', 'GE', 'GI', 'GR', 'HU', 'HR',
            'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MK', 'MT', 'NO', 'NL', 'PL',
            'PT', 'RO', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA',
        ];

  if(country !='GB' && country !==undefined && country !='US' && country !='CA' && jQuery.inArray(country, eu_Countries) === -1){
    jQuery('#payment').hide();
    jQuery('.shipping_form_wrap').show();
    jQuery('#input_4_5').val(country);
    jQuery('#input_4_6').val(shippcode);//pcode
    jQuery('#input_4_7').val(shiptown);//town
    jQuery('#input_4_8').val(shipcounty);//county
    jQuery('#input_4_13').val(products_string);


  }else{
    jQuery('#payment').show();
    jQuery('.shipping_form_wrap').hide();
  }

}//update_shipping_calc_form_checkout


function update_shipping_calc_form(){

  var shipcountry =jQuery('#calc_shipping_country').val();
  jQuery('#input_4_5').val(shipcountry);

  var eu_Countries = [
          'AL', 'AD', 'AM', 'AT', 'BY', 'BE', 'BA', 'BG', 'CH', 'CY', 'CZ', 'DE',
          'DK', 'EE', 'ES', 'FO', 'FI', 'FR', 'GE', 'GI', 'GR', 'HU', 'HR',
          'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MK', 'MT', 'NO', 'NL', 'PL',
          'PT', 'RO', 'RU', 'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'VA',
      ];


  if(shipcountry !='GB' && shipcountry !==undefined && shipcountry !='US' && shipcountry !='CA' && jQuery.inArray(shipcountry, eu_Countries) === -1){
    jQuery('.wc-proceed-to-checkout').hide();
    jQuery('.shipping_form_wrap').show();
  }else{
    jQuery('.shipping_form_wrap').hide();
    jQuery('.wc-proceed-to-checkout').show();

  }
  var shippcode =jQuery('#calc_shipping_postcode').val();
  jQuery('#input_4_6').val(shippcode);//pcode
  var shiptown =jQuery('#calc_shipping_city').val();
  jQuery('#input_4_7').val(shiptown);//town
  var shipcounty =jQuery('#calc_shipping_state').val();
  jQuery('#input_4_8').val(shipcounty);//county


var products_string='';
  jQuery('.woocommerce-cart-form__cart-item').each(function(){
    /*products.push({
      name: jQuery(this).find('.product-name'),
      price:jQuery(this).find('.product-price bdi'),
    });*/
    products_string = products_string + jQuery(this).find('.product-name').text() +': '+ jQuery(this).find('.product-price bdi').text() +', ';
  });
  //products.join();

  jQuery('#input_4_13').val(products_string);

};

if(jQuery('.another-klarna-wrap').length){

  jQuery('.another-klarna-wrap .learn-more').click(function(){
    jQuery('.klarna-overlay,.klarna-popup').show();
  });

  jQuery('.klarna-overlay, .klarna-popup .close').click(function(){
    jQuery('.klarna-overlay,.klarna-popup').hide();
  });

  jQuery('body').on('found_variation', function(event, variation){

    var price = 0;
    price = variation.display_price/3;

    if(price > 0){
      jQuery('.another-klarna-wrap .amountwrap, .klarna-popup .amountwrap').show();
      jQuery('.another-klarna-wrap .amountwrap .amount, .klarna-popup .amountwrap .amount').html('£'+price.toFixed(2));
    }else{
      jQuery('.another-klarna-wrap .amountwrap, .klarna-popup .amountwrap').hide();
    }


    jQuery(".variations select").on('change', function() {
      if (jQuery(this).val() == ''){
        jQuery('.another-klarna-wrap .amountwrap,.klarna-popup .amountwrap').hide();
      }
    });

  });

}//if klarna length
